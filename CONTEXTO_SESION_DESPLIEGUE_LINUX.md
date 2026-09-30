# Despliegue en servidor Linux + export Excel pendiente (2026-07-31)

**Sesión anterior:** `CONTEXTO_SESION_PRODUCCION_TEMAS_EXPORT.md`

## 1. Servidor de producción — ya desplegado y funcionando
Servidor Debian 13 ("Portales", `172.16.83.21`), **compartido** con otras apps
(mvt_admin, mvt_mapa, precios_gasolina, pnih, gitlab-runner). Usuario de
trabajo: `mvazquez` (sudo completo). No hay Nginx — **Apache2** es el reverse
proxy de todo el servidor.

**TIH quedó publicado en:** `http://172.16.83.21:8091/`
- Backend: systemd `tih_backend.service`, gunicorn+uvicorn en `127.0.0.1:8005`, 2 workers.
- Frontend: `dist/` estático servido por Apache desde `/opt/tih/frontend/dist`.
- Apache vhost dedicado: `/etc/apache2/sites-available/tih.conf` (puerto **8091**, aislado — no toca los vhosts existentes en :80/:8000/:8090).
- Repo clonado en `/opt/tih` (remoto interno GitLab `https://172.16.196.12/mvazquez/tih.git`, cert autofirmado → `git config http.sslVerify false` ya seteado en ese repo).
- BD: apunta al **servidor 99 de Umbraco** (`DB_SERVER=172.16.200.99\UMBRACODB`, `DB_NAME=cmde_public`, usuario `estadistica`) — decisión explícita del usuario: Umbraco tiene datos frescos (se actualiza constantemente) aunque no tenga índices, a diferencia de la BD local optimizada. **El `.env` local de tu máquina sigue apuntando a tu BD local** — cada entorno tiene su propio `.env` (no versionado), eso no cambia nada de código.

Archivos de despliegue versionados en `deploy/`:
- `tih_backend.service` — unit de systemd.
- `apache_tih.conf` — vhost de Apache.
- `DESPLIEGUE.md` — guía paso a paso completa (instalación desde cero).

## 2. Bugs reales de código encontrados y corregidos durante el despliegue
No eran problemas del servidor — eran bugs preexistentes que Windows nunca
expuso:

- **`backend/app/services/pozos_cache.py`**: `_connect()` usaba
  `Trusted_Connection=yes` fijo (auth integrada de Windows/SSPI), ignorando
  `DB_USER`/`DB_PASSWORD`. En Windows nadie lo notaba porque siempre hay
  sesión de Windows disponible; en Linux sin Kerberos truena con
  `SSPI Provider: No credentials were supplied`. Ya usa el mismo patrón que
  `database.py` (`UID`/`PWD` si hay `DB_USER`, si no `Trusted_Connection`).
- **`backend/app/database.py`**: `pyodbc.connect(conn_str)` no tenía
  `timeout` explícito — se le agregó `timeout=30`.

## 3. Compatibilidad con Python 3.13 (el servidor no tiene 3.11/3.12 disponibles por apt)
`backend/requirements.txt` tenía versiones pineadas de antes de que Python
3.13 existiera, sin wheel precompilado → pip intentaba compilar desde fuente
y fallaba (meson/pandas, PyO3/pydantic-core, pyodbc). Se aflojaron los pines:
`pandas>=2.2.3,<2.3`, `numpy>=2.1,<2.3`, `pyodbc>=5.2,<6`, `pydantic>=2.9,<3`,
`pydantic-settings>=2.5,<3`, `sqlalchemy>=2.0.31,<2.1` (2.0.30 tiene un bug
real con 3.13, no es tema de wheels). **No se tocó nada más del código** —
solo los pines. Si en el futuro hay otro entorno con Python 3.11/3.12, estas
versiones siguen siendo compatibles hacia atrás.

## 4. El bug más sutil: `EnvironmentFile=` en el `.service` corrompía `DB_SERVER`
Sesión larga de debugging: la app conectaba perfecto a mano (`uvicorn`,
incluso `gunicorn` manual desde la sesión SSH) pero fallaba con
`Login timeout expired` **solo** corriendo como servicio systemd — timeout
completo de 30s, no un rechazo instantáneo (eso ya apuntaba a red/DNS, no a
límite de conexiones).

Causa real: el `.service` tenía `EnvironmentFile=/opt/tih/backend/.env`,
que es **redundante** — la app ya carga `.env` sola vía
`pydantic-settings` (`model_config = {"env_file": ".env"}` en `config.py`).
Pero systemd usa su propio parser tipo shell para `EnvironmentFile=`, que
interpreta mal el backslash de `DB_SERVER=172.16.200.99\UMBRACODB`
(instancia con nombre) — y como las variables de entorno del proceso tienen
prioridad sobre el `.env` en pydantic-settings, la app terminaba usando un
`DB_SERVER` corrupto **solo bajo systemd**. Se quitó `EnvironmentFile=` del
`.service` y quedó resuelto. **Lección para el futuro**: si esta app se
despliega en otro lado con systemd, NO agregar `EnvironmentFile=` apuntando
al mismo `.env` que ya usa `pydantic-settings` — es redundante y puede
corromper valores con backslash o caracteres especiales.

## 5. Workflow de sincronización servidor ↔ repo (para la próxima sesión)
- El editor real de archivos en el servidor termina siendo `nano` a mano, o
  bajar/subir por `scp` cuando la edición es larga — **no hay Node/npm en el
  servidor**, así que el frontend siempre se compila en Windows
  (`npm run build`) y se sube el `dist/` ya armado.
- Repo interno usa cert autofirmado → cualquier `git` contra
  `172.16.196.12` en el servidor necesita `-c http.sslVerify=false` (o ya
  quedó seteado por repo en `/opt/tih/.git/config`).
- Actualizar el backend en producción: `git pull` en `/opt/tih` +
  `sudo systemctl restart tih_backend`. Actualizar frontend: rebuild local +
  `scp -r dist/* mvazquez@172.16.83.21:/opt/tih/frontend/dist/` (verificar
  permisos `o+rX` después, Apache corre como `www-data` y necesita poder
  atravesar `/opt/tih/frontend/dist`).
- Ya se hizo commit + push de todos los fixes de este despliegue
  (`400347b`/`12b7e37` en `master`). El repo del servidor y tu local ya están
  sincronizados en cuanto a estos cambios.

## 6. Pendiente sin terminar: export a Excel plano/pivote de Producción
Viene de la sesión anterior (`CONTEXTO_SESION_PRODUCCION_TEMAS_EXPORT.md`,
sección 5) — el usuario pidió cambiar TODOS los descargables de Producción
al formato del archivo de ejemplo
`TIH_Producción por cuenca y ubicación_ejemplo.xlsx` (banner + metadatos
multilínea + tabla **plana/pivote**: una fila por combinación Ambiente+Cuenca,
una columna por producto — en vez del árbol indentado jerárquico que ya
existía).

**Estado actual (sin commitear todavía, cambios en working tree):**
- `frontend/src/utils/exportExcel.js`: soporta un nuevo parámetro
  `tablaPivot` (`{columnasIdentidad, columnasValor, filas}`) además del
  `tabla` jerárquico viejo (se mantiene por compatibilidad con Pozos, que
  también usa esta función). Metadatos: `subtitulo` soporta texto
  multilínea (una línea por filtro, merge de 2 filas, centrado tamaño 8);
  `periodoNota` usa separador "—".
- `frontend/src/components/Charts/DynamicTable.jsx`: nueva función
  `buildPivotExport()` que reconstruye la tabla plana desde `extractLeaves()`
  (datos crudos del backend), NO desde las filas ya renderizadas en pantalla
  — agrupa por Ambiente/Cuenca y pivotea el producto (o la entidad de
  drill-down, según nivel activo) a columnas. Fallback especial cuando no
  hay filtros activos (`extractLeaves` descarta el grupo "Nacional" a
  propósito para el drill-down, así que sin filtros el pivote quedaba vacío
  — se corrigió).
- Bug de visibilidad corregido: `visibleSeries` (chips de producto en la
  gráfica) NO debe filtrar filas del pivote salvo en el primer nivel activo
  de la jerarquía — aplicarlo a producto/operador descartaba casi todo
  porque esas chips vienen apagadas por defecto.

**Falta por hacer / verificar en la próxima sesión:**
1. Probar la descarga real en el navegador para **Producción por
   cuenca/ubicación** con Ambiente+Cuenca activos (el caso ya verificado
   manualmente por el usuario, con datos).
2. Probar los demás temas de Producción con drill-down: Campos, Asignaciones,
   Operadores, Gcompo, Estado, Contratos — cada uno tiene una forma distinta
   de armar `groups`/`subgroups` (ver `HIER_LEVELS`/`activeHierLevels` en
   `DynamicTable.jsx`), y el pivote genérico (`buildPivotExport`) no se ha
   probado contra todos.
3. Confirmar el caso de **múltiples períodos seleccionados** (más de un año)
   — el código expande `columnasValor` a `Producto — Periodo` por cada
   combinación, pero no se ha probado visualmente si el resultado es legible
   en Excel.
4. Una vez validado, hacer commit + push de estos cambios (a la fecha de
   este documento siguen solo en el working tree local, no en git).
5. Recordar: **no se debe volver a exportar cientos de commits/pushes sin
   avisar** — el usuario pidió explícitamente ahorrar tokens/tiempo; agrupar
   cambios y confirmar antes de operaciones de red pesadas.

## 7. Notas de proceso para la próxima sesión (aprendizajes de esta)
- El usuario trabaja todo por consola SSH, sin experiencia previa de
  sysadmin — las instrucciones deben ser copy-pasteables literales, un
  bloque por vez, sin asumir que sabe qué terminal usar en cada paso (varias
  veces confundió la sesión SSH del servidor con su terminal local de
  Windows).
- Cuando edito un archivo local para el servidor, **recordar que el archivo
  no llega solo** — hay que subirlo por `scp` o hacer commit+push
  explícito; pasó varias veces que edité algo localmente y el servidor
  siguió con la versión vieja porque nadie lo sincronizó.
- Antes de commitear/pushear: siempre confirmar con el usuario antes (se
  hizo bien esta sesión, preguntando explícitamente antes del push grande al
  final).
