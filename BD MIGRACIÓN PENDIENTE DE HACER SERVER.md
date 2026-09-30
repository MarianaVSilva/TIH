# BD Migración — pendiente de hacer server (2026-08-21/22)

Notas de sesión para retomar el tema de la migración a PostgreSQL. Contexto
completo y técnico de la migración en sí (bugs encontrados, validaciones,
dominios) está en [`postgres_migration/MIGRATION_STATUS.md`](postgres_migration/MIGRATION_STATUS.md)
— este documento es sobre el **estado operativo/de despliegue**, no repite
ese detalle.

## 1. Decisión tomada: puente, no cargadores nuevos

El equipo sigue y va a seguir cargando datos a SQL Server (`172.16.200.99`,
instancia `UMBRACODB`). Se decidió **no** reescribir sus cargadores para que
apunten directo a Postgres — en vez de eso, se construyó un puente
automático que sincroniza SQL Server → Postgres, para no tocar el flujo de
trabajo del equipo ni duplicar los ~20 bugs de collation/acentos/duplicados
ya cazados durante la migración.

Reconsiderar esta decisión solo si algún día Postgres pasa a ser la fuente
de verdad para *todo* (no solo TIH) y se quiere apagar SQL Server por
completo.

## 2. Qué existe hoy y dónde

- **Rama `master`** (en producción, `http://172.16.83.21:8091/`): TIH sigue
  leyendo de SQL Server, sin cambios de comportamiento. Es la rama estable.
- **Rama `postgres`** (creada esta sesión, subida a `origin/postgres`, NO
  mergeada a master): un solo cambio de código real —
  [`backend/app/config.py`](backend/app/config.py) tiene `db_engine: str = "postgres"`
  como default (en `master` sigue siendo `"mssql"`). Todo el backend
  (12 servicios) ya soporta ambos motores desde antes.
- **Postgres**: corre **local, en esta máquina Windows**
  (`localhost:5433`, db `tih_pg`, user `postgres`). Todavía no está en
  ningún servidor.
- **El puente** (`postgres_migration/run_bridge.py`): extrae de SQL Server,
  recarga `staging → core → api`, refresca las materialized views. Probado
  y funcionando (última corrida completa: 411s / ~7 min, sin errores).
- **Tarea programada**: `TIH_Puente_SQLServer_a_Postgres` en el **Task
  Scheduler de Windows de esta máquina**, corre todos los días a las 3:00 AM
  (ver [`postgres_migration/setup_bridge_task.ps1`](postgres_migration/setup_bridge_task.ps1)).
  **Solo funciona mientras esta PC esté prendida** — no es un servicio de
  servidor.
- **Rendimiento medido** (primera llamada, sin caché, comparando SQL Server
  remoto vs Postgres local): ~1.4x a ~2.5x más rápido según la consulta.
  Con caveat: parte de esa ganancia es latencia de red (Postgres en
  localhost vs SQL Server al otro lado de la red) — cuando Postgres esté en
  un servidor real, la comparación va a ser más representativa (probablemente
  algo menos dramática por la red, pero el esquema particionado + BRIN +
  pre-agregado en `core`/`api` sigue dando ventaja real).

## 3. Pendiente: mover Postgres a un servidor

El usuario dijo "el postgres lo voy a subir a un server" — sin definir
todavía cuál servidor ni cuándo. Cuando se retome, hace falta:

1. **Elegir/tener listo el servidor** (Linux o Windows, aún sin decidir).
2. **Reachability de red en ambos sentidos**:
   - El servidor nuevo de Postgres necesita alcanzar `172.16.200.99:1433`
     (SQL Server, para que el puente pueda extraer).
   - El servidor de producción de TIH (`172.16.83.21`) necesita alcanzar el
     puerto de Postgres en el servidor nuevo.
   - Revisar firewall/reglas de red antes que nada — es lo más probable que
     falle primero (mismo patrón que ya se vio al desplegar el backend en
     172.16.83.21, ver `CONTEXTO_SESION_DESPLIEGUE_LINUX.md`).
3. **Instalar Postgres 17 en el servidor nuevo** y correr el DDL de
   `postgres_migration/sql/` (`01_staging_schema.sql`, `02_core_schema.sql`,
   `03_api_schema.sql`) para crear el esquema desde cero ahí.
4. **Primera carga completa**: correr `run_bridge.py` contra el Postgres
   nuevo (necesita un `postgres_migration/.env` apuntando a ese servidor).
5. **Mover la tarea programada**: hoy es Task Scheduler de Windows en esta
   PC — si Postgres queda en un servidor Linux, conviene reemplazarla por un
   `cron` job ahí mismo corriendo `run_bridge.py` (el script en sí no
   cambia, solo cómo se programa).
6. **Actualizar configuración**:
   - `backend/.env` (rama `postgres`, en el servidor de producción de TIH si
     se llega a desplegar esa rama): `PG_HOST`/`PG_PORT` apuntando al
     servidor nuevo en vez de `localhost:5433`.
   - `postgres_migration/.env` (en la máquina/servidor que corra el puente):
     mismo cambio.
7. **Decidir dónde vive el puente**: ¿en el mismo servidor de Postgres, en
   el servidor de TIH (172.16.83.21), o en otro lado? Afecta si necesita
   también el driver ODBC de SQL Server instalado ahí (`pyodbc` +
   `ODBC Driver 17 for SQL Server`, igual que ya se resolvió para el backend
   en 172.16.83.21).
8. **No desplegar la rama `postgres` a producción todavía** salvo que se
   decida explícitamente — por ahora sigue siendo un entorno de prueba local.

## 4. Archivos clave para retomar

- [`postgres_migration/MIGRATION_STATUS.md`](postgres_migration/MIGRATION_STATUS.md) — bitácora completa de la migración de datos (bugs, validaciones, qué falta a nivel de datos: SISEAA, ambigüedad de precios, etc.)
- [`postgres_migration/run_bridge.py`](postgres_migration/run_bridge.py) — el puente en sí
- [`postgres_migration/setup_bridge_task.ps1`](postgres_migration/setup_bridge_task.ps1) — registro de la tarea programada (hoy Windows; sirve de referencia para el equivalente en el servidor nuevo)
- [`postgres_migration/sql/`](postgres_migration/sql/) — DDL completo (staging/core/api)
- [`backend/app/config.py`](backend/app/config.py) — `db_engine` y variables `PG_*`
- [`backend/.env.example`](backend/.env.example) — variables documentadas (sin secretos)
- Rama `postgres` en el repo (`origin/postgres`)
