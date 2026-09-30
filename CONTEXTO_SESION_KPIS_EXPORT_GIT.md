# KPIs, Pozos, Exportables e Infra de Git — 2026-07-24/27

**Sesión anterior:** `CONTEXTO_SESION_UI_POLISH_2.md`

## 1. KPIs (ChartArea.jsx + PozosExplorer.jsx)
- Rediseño: cards blancas con punto de color (no icono en caja), consistente con `dataviz` skill. Verde = líquidos (`#0d7a4a`), azul = gas (`#1d6fa5`), agua `#38bdf8`.
- `KpiCards` y `KpiRow` ahora filtran KPIs con valor 0/null (no se muestran).
- Los KPIs muestran **solo el último período del rango seleccionado** (no promedio). Se agregó nota `periodoNota` visible: "Datos de X — el último período..." en ambos niveles (pozo y campo/cuenca).
- Botón "×" para volver al nivel anterior: en KpiRow (campo→cuenca) y en el header del pozo (pozo→resumen). Movido después a la cabecera de `PozoRankingCard` (campo/cuenca) por pedido del usuario — no en el bloque de KPIs.

## 2. Producción por ubicación (ChartArea.jsx)
- "Ver como gráficos" ahora separa Mbd vs MMpcd en dos gráficas (mezclar unidades distorsiona escala).
- Modo "Por cuenca": antes solo graficaba líquidos: ahora un mini-gráfico por cada producto (`buildProdCuencaSeriesPorCuencaTodos`).
- Fix: contenedor de gráficas sin `overflow-y:auto` → no se podía hacer scroll a los últimos productos. Agregado.

## 3. Producción por pozo — bugs de gas/líquidos (backend `pozos_service.py`)
Cuencas de gas seco (ej. Burgos) tienen líquidos=0 todo el histórico. Varias funciones asumían líquidos por default y rompían:
- `_serie_mensual_pozo(engine, campo, pozo, metrica="auto")`: ahora devuelve `(serie, well_id, unidad)` con columna genérica `"valor"` (antes `liquidos_mbd`). `metrica` puede forzarse a `"liquidos"`/`"gas"` (usado por el switch Mbd/MMpcd en frontend). **Todo lo que llama a esta función debe desempacar 3 valores y usar columna `"valor"`** — se rompió 2 veces por no actualizar callers (`get_pozos_comparar`).
- `get_pozo_analisis(..., metrica="auto")`: idem, expone `unidad` en la respuesta.
- `get_pozos_ranking`: rankea por gas si líquidos=0 en el rango. **Recalcula tendencia con histórico completo** (no solo el rango de UI) para que coincida con el detalle del pozo — pero esto es caro a nivel cuenca (miles de pozos, colgaba el request). Fix: el recálculo completo solo aplica si `len(ranking) <= 300` (nivel campo); a nivel cuenca se queda con tendencia period-scoped.
- `get_pozos_comparar`: **bug reciente** — no se actualizó tras el cambio de `_serie_mensual_pozo` (desempacaba 2 valores de una tupla de 3, columna vieja `liquidos_mbd`) → excepción no capturada → frontend mostraba "sin datos" silenciosamente. Corregido. Además nunca respetaba `period` (siempre mensual pese a "Anual" seleccionado) — ahora hace rollup con `.groupby("periodo").mean()` igual que el resto del tablero.
- Frontend (`PozosExplorer.jsx`): switch Mbd/MMpcd en pozos con ambos productos, colores verde/azul consistentes, tabla de detalle con heatmap por fila, mensajes de alerta sin sugerencias de acción ("Evaluar intervención" removido, solo se describe el hecho).
- `PozoTrendChart.jsx`: `forwardRef` + `getImage()` (para exportar), quitados los botones de período propios (3m/6m/12m/24m/Todo) — ahora sigue el filtro de Período global. Si <2 puntos en rango: mensaje en vez de gráfica vacía.

## 4. Comparar pozos (`PozosComparar.jsx`)
- Rediseño completo: tabla resumen (tendencia/decl. anual/etc, con badges de color) + tabla nueva "Producción por período" (columnas por año/mes, heatmap, toggle "Columnas").
- Texto invisible corregido (celdas sin color explícito heredaban blanco).
- Exportable cambiado de CSV a **`.xlsx`** vía `exportExcel.js` (mismo banner que los demás), con imagen de la gráfica embebida.

## 5. Exportar a Excel (`frontend/src/utils/exportExcel.js`, nuevo, usa `exceljs`)
- Banner verde oscuro con logo (`public/logosener-blanco.png`, 1920×1080 16:9 — insertar en 110×62, NO 130×42, se ve aplastado si no se respeta el aspect ratio).
- **Bug ExcelJS**: no se puede mergear el rectángulo completo del banner y luego sub-rangos dentro — "Cannot merge already merged cells". Fix: pintar fill celda por celda, mergear solo los sub-rangos de texto.
- Usado en: `PozosExplorer.jsx` (vista pozo/campo/cuenca) y `PozosComparar.jsx`.
- CSV normal (`DynamicTable.jsx`) necesita BOM UTF-8 al inicio (`"\uFEFF" + contenido`) o Excel corrompe acentos/ñ (mojibake: "CAÑÓN" → "CAÃ'Ã"N").

## 6. Indicadores Económicos (`precios_service.py`)
- **Bug Brent**: `chartPreviousClose` de Yahoo NO es "cierre de ayer", es el cierre del primer día de la ventana `range` pedida (con `range=5d`, ~5 días hábiles atrás) → inflaba el % artificialmente. Fix: tomar el penúltimo valor de la serie diaria `indicators.quote[0].close`.
- **Bug Mezcla Mexicana**: tabla `PRECIOS` (BD) no se actualiza a diario (llegó a estar 10 días atrasada) → "cierre anterior" comparaba contra un dato viejo. Fix: nueva tabla propia `dbo.PRECIOS_AUTOM` (FECHA, PRODUCTO, VALOR, FUENTE, ACTUALIZADO_EN — se auto-crea) que guarda el valor del día (Brent y MME) cada vez que se consulta; `_get_mme_anterior` prioriza esta tabla sobre `PRECIOS` (con salvaguarda de 5 días de brecha si cae al fallback).
- `HomeDashboard.jsx`: refresco automático 1x/día a las 18:00 hora local (no polling cada N min) — Pemex publica MME antes de las 6pm.

## 7. Git / GitLab (NUEVO — antes no existía)
- ⚠️ Repo real del proyecto estaba en `TIH/`, pero el `.git` existente estaba mal ubicado en `C:\Users\Mariana Vasquez\.git` (rastrearía todo el perfil de Windows) — se dejó intacto, se creó uno nuevo en `TIH/`.
- Remoto: `https://172.16.196.12/mvazquez/tih.git`, rama `master`.
- `.gitignore`: excluye `node_modules`, `__pycache__`, `.env`, `.claude/`, y **todos** los `.md`/`.pdf`/`.csv`/`.xlsx` (pedido explícito del usuario — solo código funcional).
- **Fugas de credenciales encontradas y corregidas**: `backend/.env.example` tenía password real de SQL Server en texto plano (saneado a placeholders); `backend/check_columns.py` también tenía password real — se excluyó del repo. Ambas ya habían llegado a git antes de detectarlas; se hizo `git commit --amend` + el usuario recreó el repo en GitLab desde cero (branch protegida no permitía force-push) y se hizo push limpio.
- Commit único actual: `182fd5d "Initial commit: TIH dashboard (frontend + backend)"`.
- Se corrió un agente para limpiar comentarios "estilo IA" (narración de fechas/sesiones/bugs) en 11 archivos, dejando solo comentarios de regla de negocio no obvia.

## Pendientes / notas
- `backend/.env` (real, con credenciales) sigue existiendo localmente, correctamente gitignorado — no tocar.
- Si se agregan más funciones que llamen a `_serie_mensual_pozo`, recordar que devuelve 3-tupla con columna `"valor"` genérica, no `"liquidos_mbd"`.
- Servidores backend corren SIN `--reload` (`.claude/launch.json`) — hay que reiniciar manualmente el preview tras cada cambio en `backend/`.
