# Contexto de sesión — TIH pasa a BD local + analítica avanzada de "Producción por pozo"

Fecha: 2026-07-15

## Parte 1 — La app completa pasa a apuntar al SQL Server local

**Por qué:** `cmde_public.dbo.PRODUCCION_POZOS` (~3.4M filas) resultó ser una **vista**, no una tabla — `UNION` de `cmde_valid.dbo.PRODUCCION_POZOS_A2016` (histórico, con `LEFT JOIN` a `cmde_raw.dbo.bd_pozos`) y `cmde_valid.dbo.SIH_PRODUCCION_D2016` (diario desde 2016, agregado a mensual con `GROUP BY`+`JOIN`). Sin índice posible sobre una vista así, cualquier consulta a escala nacional contra el servidor remoto (`172.16.200.99\UMBRACODB`) tardaba >90s.

El usuario ya tenía (o completó durante la sesión) un clon local de `cmde_public`, `cmde_valid` y `cmde_raw` en su propio SQL Server (`localhost`, Windows Auth). Se decidió mover **toda** la app ahí, no solo Pozos.

**Cambios:**
- `backend/.env`: `DB_SERVER=localhost`, `DB_INSTANCE=`, `DB_USER=`, `DB_PASSWORD=` (vacíos → Windows Auth).
- `backend/app/database.py` (`_make_connection`): ahora usa `ODBC Driver 17 for SQL Server` (el driver legacy `SQL Server` no conectaba a local), solo concatena `\instancia` si no está vacía, y usa `Trusted_Connection=yes` en vez de `UID`/`PWD` cuando `db_user` está vacío.
- Verificado: los 9 temas existentes (Cuenca, Campos, Contratos, Reservas, Precios, etc.) devuelven los mismos datos que antes contra remoto — sin regresión.

## Parte 2 — Caché indexado para Pozos (`TIH_pozos_cache`)

Aunque local ya bajó una consulta nacional de >90s a ~3s, para las funciones interactivas nuevas (filtros, ranking, scatter) se materializa `PRODUCCION_POZOS` en una BD local nueva, `TIH_pozos_cache.dbo.produccion_pozos`, con índices `(WELL_ID,FECHA)`, `(ASIG_CONT,FECHA)`, `(CUENCA)` — baja a **~0.27s**. Refresco completo: ~75-95s (medido dos veces), corre en background thread.

- `backend/app/services/pozos_cache.py`: `ensure_cache_database`, `_refrescar` (recrea la tabla vía `SELECT * INTO` cross-DB same-instance, corrige columnas `*(MAX)` de la vista antes de indexar — `ASIG_CONT`/`UWI`/`BLOCK_ID` salen como `NVARCHAR(MAX)`/`VARCHAR(MAX)` por los `REPLACE`/`UPPER` anidados de la vista, no son indexables así), `is_cache_available`/`get_cache_status` (leen el estado **de la BD**, no de memoria del proceso — el backend se reinicia manual y seguido, sin esto se perdía el estado en cada reinicio), `trigger_refresh`.
- Índices ligeros agregados también a `cmde_public.dbo.cat_pozos(well_id)` y `cmde_raw.dbo.bd_pozos(WELL_ID)` (su propio clon local, sin riesgo).
- Endpoints: `POST /produccion/pozos/refrescar-cache`, `GET /produccion/pozos/cache-status`.

## Parte 3 — Analítica nueva (`backend/app/services/pozos_service.py`)

Se movieron aquí `get_produccion_pozos_arbol/pozo_detalle/pozos_resumen` (antes en `produccion_service.py`), ahora contra el caché cuando está listo, y se agregó:

- **`get_pozo_analisis`**: declinación mensual/anual, `tendencia` (CRECIENDO/ESTABLE/DECLINANDO/CRITICO, regla de suma de 3 meses), promedios 3/6/12m, % vs pico histórico, proyección de vida útil (estimado exponencial simple, etiquetado como tal), alerta. Enriquecido con datos **reales** de `cmde_raw.dbo.bd_pozos` (join por `WELL_ID`): `CURRENT_CONDITION` → estado operativo real (Productor/Inactivo/Cerrado/Abandono.../En inyección — no un enum inventado), `DRILLING_START_DATE` → años en producción real, operador, profundidad, categoría.
- **`get_pozos_ranking`**, **`get_pozos_filtrados`** (a escala nacional — factible por el índice), **`get_pozos_comparar`** (2-4 pozos), **`get_campo_scatter`** (lat/long reales de `bd_pozos`), **`exportar_pozos_csv`**.
- **Bug encontrado y corregido**: `cmde_raw.dbo.bd_pozos` puede tener **más de una fila por WELL_ID** (sidetracks/reentradas comparten WELL_ID, ej. Maloob-429D/Maloob-429DREE) — sin deduplicar antes del join, se duplicaban pozos en ranking/filtrados. Fix en `_meta_bd_pozos`: dedupe por `well_id` prefiriendo la fila con `CURRENT_CONDITION` no nula.
- Vectorizado `_tendencia_por_pozo` con pandas (groupby+shift+rolling) en vez de loop Python — bajó de 6.5s a ~2s sobre ~8000 pozos nacionales.

**Fuera de alcance** (documentos en `TIH_Mejoras_Analíticas.md` sin base real o sin infraestructura): exportación PDF/Excel, reportes programados, Slack/SCADA/SAP, jobs nocturnos, Redis, tabla `POZO_METRICAS_CALCULADAS` en la BD remota.

## Parte 4 — Frontend

`PozosExplorer.jsx` ampliado: banner de estado del caché + botón "Actualizar" (poll cada 3s mientras sincroniza), badge de estado operativo real + tendencia junto al pozo, banner de alerta, checkbox "Modo comparar". Nuevos: `PozoTrendChart.jsx` (línea + markLine pico/promedio + markArea declinación), `PozoRankingCard.jsx` (barras top/bottom + tabla), `PozoCampoScatter.jsx` (scatter lat/long real, color=tendencia), `PozoProyeccion.jsx`, `PozosFiltrosPanel.jsx` (reemplaza el árbol por lista filtrada), `PozosComparar.jsx`.

**Bug encontrado y corregido**: `exportarPozosCsvUrl` en `client.js` mandaba literalmente `produccion_min=undefined` cuando el filtro numérico quedaba vacío (`URLSearchParams` serializa `undefined` como string) — se filtran los valores `undefined`/`null` antes de construir la URL.

## Verificado en el navegador (preview real, no solo curl)

Árbol → campo → pozo con producción real (TUPILCO-3005DES, campo COMALCALCO): tendencia DECLINANDO, alerta "Declinación moderada: 3.7%...", proyección "~13 años 7 meses", tabla de detalle correcta. Vista de campo: KPI + ranking (17 pozos, sin duplicados tras el fix) + scatter. Filtro nacional por tendencia CRITICO: 1546 pozos, lista ordenada por producción, sin duplicados. Exportación CSV funcional tras el fix de `undefined`.

## Cómo levantar el entorno local

Igual que antes, pero ahora todo corre contra `localhost` (Windows Auth) — no necesita VPN/acceso al servidor remoto para el día a día. Para refrescar el caché de Pozos: `POST /api/v1/produccion/pozos/refrescar-cache` (o el botón "Actualizar" en la UI), tarda 1-2 min.
