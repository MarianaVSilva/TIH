# Sesión Producción — 2026-08-18

## 1. Producción por ubicación
- Ortografía: `acentuarTema()` movida a `frontend/src/utils/acentuarTema.js` (antes solo en TopBar), aplicada también a `tituloTema` en ChartArea.jsx — corrige acentos en título de cualquier tema, no solo el dropdown.
- Bug filtro de series (chips Gas/Gas asociado/etc. no ocultaban filas en tabla): corregido en dos lugares de `DynamicTable.jsx` — `groupBy==="ubicacion"` (rama "Por ambiente") y `renderOperators` de `flattenMultiLevel` (vista por defecto Cuenca→Ambiente→Producto) no aplicaban `vis`.
- Excel reorganizado: `buildPivotExport` en DynamicTable.jsx ahora pone Fecha como columna/fila (mes completo si es mensual, vía `formatFechaExport`) en vez de aplanarla en el nombre de columna ("Producto — Año"). Afecta a TODOS los temas que usan el export genérico, no solo este.
- "Descargar todo": nuevo endpoint `GET /produccion/historico?topic=Cuenca|Campos` (`get_produccion_historico` en pozos... no, en `produccion_service.py`), consulta cruda a `PRODUCCION_CAMPOS` sin agregación. Frontend: `fetchProduccionHistorico` en client.js, prop `historicoFetch` en DynamicTable (generalizado, antes hardcodeado a Perforación).
- "Producción por campo" descarga completa: sin columna "Campo" (pedido explícito) — parámetro `incluir_campo = topic == "Cuenca"` en `get_produccion_historico`.

## 2. Recursos y Reservas (tema previo, referencia)
- Reservas por campo/asignación-contrato: jerarquía reordenada a Cuenca→Ambiente→item (antes Ambiente→Cuenca). Ambiente ahora es cabecera gris con sangría, 3 estados de clic (cerrado→detalle completo→solo nombres→cerrado), mismo patrón `cycleCuenca` que ya existía. Helper `pushAmbienteHeader()` en DynamicTable.jsx.

## 3. Producción por pozo
- Tendencia (CRECIENDO/ESTABLE/DECLINANDO/CRITICO): ventana de momentum cambiada de 3 a 6 meses (`_UMBRAL_MOMENTUM` y umbrales derivados vía interés compuesto exponente 0.5 en vez de 0.25) en `pozos_service.py`. Ver `_tendencia()`, `_tendencia_por_pozo()`.
- Nuevo modal `TendenciaDesgloseModal.jsx` (popup centrado, fondo oscurecido, banner TIH) con desglose paso a paso de la fórmula — reemplaza la idea original de generar un PDF. Endpoint `GET /produccion/pozos/tendencia-desglose`, función `get_pozo_tendencia_desglose()`. Botón "i" junto al badge de tendencia en `PozoRankingCard.jsx` (ranking) y `PozosExplorer.jsx` (detalle individual).
- Bug corregido: ranking a nivel CUENCA no traía el `campo` de cada pozo — al hacer clic en un pozo de un campo distinto al primero de la lista, fallaba "sin producción registrada". `get_pozos_ranking` ahora selecciona `ASIG_CONT` y lo expone como `campo` por fila; frontend pasa `p.campo` al hacer clic (antes asumía uno solo para toda la tabla).
- Bug corregido: ranking mostraba el último MES crudo (ej. 6.89) mientras el detalle en vista anual promediaba los meses del año (6.85) — no coincidían. Ahora `get_pozos_ranking` calcula `produccion_mbd` con el mismo rollup por periodo (promedio) que el resto del tablero.
- Crash corregido: pozos sin `WELL_ID` quedaban con `produccion_mbd = null` tras el merge de arriba (pandas descarta NaN en groupby por default) y tronaba toda la `<PozoRankingCard>` (`Cannot read properties of null (reading 'toLocaleString')`). Fix: `dropna=False` en el groupby + `.fillna(0)` de respaldo.
- 3 decimales en toda la sección Producción por pozo: backend (`pozos_service.py`) redondea a 3 en vez de 2; frontend fuerza `minimumFractionDigits:3` en KPIs, tabla detalle, ranking, comparar.
- "Tendencia de producción" → "Producción observada" (título del gráfico), en `PozosExplorer.jsx` y `PozoTrendChart.jsx`.
- Barra de carga animada (`LoadingBar.jsx`, nuevo componente) en el panel derecho mientras carga el ranking de una cuenca/campo — antes quedaba en blanco.
- Header del detalle de pozo ahora muestra fecha de perforación: "Campo · Perforado el dd/mm/aaaa" (dato ya existía en `analisis.fecha_perforacion`, solo faltaba mostrarlo).

## 4. Producción por operador
- Jerarquía invertida: antes Empresa→Producto→Contrato (repetía el nombre del contrato una vez por cada producto). Ahora Empresa→Contrato/Asignación→Producto. Función `_filas_empresa_por_contrato()` (antes `_filas_empresa_por_producto`) en `produccion_service.py`.
- Banner "Total Mbd/Total MMpcd" se preservó SIN filas duplicadas: `totalesPorUnidad()` en DynamicTable.jsx ahora suma las filas `operator` con label "Hidrocarburos líquidos (Mbd)"/"Gas (MMpcd)" repetidas bajo cada contrato, cuando no encuentra el subtotal dedicado (fallback genérico, no rompe otros temas que sí tienen ese subtotal).
- El contrato YA NO muestra una cifra en el encabezado (antes PCE = líquidos + gas/5, ej. "80.01" — confundía mezclar Mbd+MMpcd en un solo número). Ahora `data: [None...]` en ese subtotal.
- Excel export dedicado: `buildOperadorTabla()` en DynamicTable.jsx (el genérico `buildPivotExport` asume subtotal=producto siempre, y aquí está invertido). Prop `exportOperadorTabla` en DynamicTable, conectado tanto a "Exportar Excel" como a "Generar reporte" (PDF) vía `esOperadores` en ChartArea.jsx.
- Nota pendiente de explicar si vuelve a salir: Hidrocarburos líquidos = Petróleo + Condensado; Gas = Gas asociado + Gas no asociado — si uno de los componentes es 0, el total coincide exactamente con el otro (no es bug).

## Archivos tocados esta sesión
- `backend/app/services/produccion_service.py`
- `backend/app/services/pozos_service.py`
- `backend/app/routers/produccion.py`
- `frontend/src/api/client.js`
- `frontend/src/components/Charts/DynamicTable.jsx`
- `frontend/src/components/Charts/ChartArea.jsx`
- `frontend/src/components/Charts/PozosExplorer.jsx`
- `frontend/src/components/Charts/PozoRankingCard.jsx`
- `frontend/src/components/Charts/PozoTrendChart.jsx`
- `frontend/src/components/Charts/TendenciaDesgloseModal.jsx` (nuevo)
- `frontend/src/components/UI/LoadingBar.jsx` (nuevo)
- `frontend/src/utils/acentuarTema.js` (nuevo, extraído de TopBar.jsx)
- `frontend/src/components/Header/TopBar.jsx`

## Nada de esto está commiteado/pusheado todavía.
