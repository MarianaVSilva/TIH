# UI Polish (segunda parte) + fórmulas Tendencia/Vida Remanente — 2026-07-17/23

**Sesión anterior:** `CONTEXTO_SESION_UI_POLISH.md` — cache auto-refresh, buscador legible, mapa eliminado, PozoRankingCard rediseñado.

## Cambios

### 1. Comparar 2-4 pozos ahora respeta el filtro de período
- **Bug encontrado**: `PozosComparar.jsx` no recibía `period/start_year/end_year/start_month/end_month`.
- **Fix**: `PozosExplorer.jsx` pasa esos props a `PozosComparar`; `client.js` (`fetchPozosComparar`) y el endpoint `/produccion/pozos/comparar` (backend `produccion.py` + `pozos_service.get_pozos_comparar`) ahora aceptan y aplican el rango de fechas.
- **Botón "Comparar años" eliminado** de `TopBar.jsx` (la función de comparar 2-4 pozos ya cubre ese caso de uso). Se quitó `compareMode`/`compareYearA/B` del useEffect de auto-fetch.

### 2. Fórmulas de TENDENCIA y VIDA REMANENTE (backend `pozos_service.py`)
Iteración larga sobre cómo se calcula `_tendencia()`. Estado final:
- **Vida remanente**: sin cambios — modelo de declinación exponencial simple (`t_años = ln(actual/límite)/k`, límite = 10% de producción actual, arbitrario). Ver docstring en código.
- **Tendencia — diseño final**:
  1. **Base** = clasificar la **tasa anual propia** del pozo (12m vs 12m previos, la misma de "vida remanente") contra umbrales de industria con fuente real: Payne Institute (declinación terminal percentil 20-80 = 2.9-9.4%/año) e IEA (Mar del Norte 8-12%/año) → se fijaron **-12%/-5%/+5%** anual.
  2. **Equivalente trimestral propio** = convertir esa MISMA tasa anual (no una referencia genérica) a trimestral por interés compuesto: `(1+anual/100)^0.25 - 1`.
  3. **Delta (momentum)** = `suma_3m - equivalente_propio`. Si se desvía >±3.15pp (el umbral crítico ya convertido), sube/baja **un nivel** de severidad respecto a la base (orden: CRITICO → DECLINANDO → ESTABLE → CRECIENDO).
  4. Sin `anual` (pozo <24 meses de histórico): fallback a solo `suma_3m` contra umbrales trimestrales fijos (-3.1/-1.3/+1.2).
- **Importante**: se descartaron dos diseños intermedios antes de llegar a este: (a) anualizar `suma_3m` × 4 (matemáticamente incorrecto, amplifica ruido), (b) tomar la "más severa" entre dos clasificaciones independientes (corto vs largo plazo) — el usuario pidió explícitamente que el efecto fuera "atenuar/agravar un nivel" en vez de eso.
- Aplicado también a `_tendencia_por_pozo()` (ranking nacional vectorizado con pandas) — ahora calcula la tasa anual con `rolling(12).mean()` + `shift(12)`.
- **Ejemplo de referencia usado en pruebas**: pozo `MALOOB-433D`, campo `A-0203-3M - CAMPO MALOOB`. Con datos reales: `suma_3m=+7.45%`, `anual=-25.96%` → tendencia final = DECLINANDO (antes del fix decía CRECIENDO, engañado por un mes atípico de +28.5%).
- **PDF didáctico generado** (ya NO existe como archivo persistente, se generó y borró del scratchpad — si se necesita de nuevo, el script está en el historial de conversación) explicando paso a paso con números reales de MALOOB-433D.

### 3. Panorama general (HomeDashboard.jsx)
- **Indicadores Económicos (Brent/Mezcla Mexicana)**: ahora muestran flecha ↑/↓ vs. cierre anterior.
  - Backend `precios_service.py`: `_get_brent_actual()` ahora también trae `anterior` (de `chartPreviousClose` de Yahoo, mismo request). `_get_mme_anterior()` nueva función que consulta el cierre previo en la tabla `PRECIOS` (columna MME). `get_indicadores_economicos(engine)` ahora recibe `engine`.
  - `resumen_service.py`: pasa `engine` a `get_indicadores_economicos`.
- **Card "Reservas 1P/2P/3P" eliminada** del carrusel derecho (ya no es dinámica). `OperadorCarousel` → `OperadorCard` (estática, solo Producción por Operador).
- **Carrusel izquierdo** (antes Top Campos ↔ Reservas top5) ahora alterna **Top Campos ↔ Producción por Operador**.
- **Card derecha** ahora es **Top 5: Reservas por campo** (estática, con selector 1P/2P/3P).
- Se borró código muerto: `ReservasWaterfallChart`, `ReservasWaterfallLegend`, `ReservasWaterfallContent`, `RESERVAS_SHADES` (ya no se usaban tras el reordenamiento) — luego parte de ese contenido volvió a usarse en la nueva card `Top5ReservasCard`, revisar que no haya quedado duplicado si se retoca.
- **"Pozos operando"**: rediseño intentado (cards estilo Indicadores Económicos) fue **deshecho** a pedido del usuario — volvió al diseño original de bloquecitos/pills. Luego se pidió una versión híbrida: mantener el bloque izquierdo naranja tal cual, agregar dos tarjetas de color a la derecha (verde/azul) en vez de los bloquecitos — **esta versión sí se mantuvo**. Ambas cards centradas (`items-center justify-center text-center`).
- **Label "Abril 2026"** ahora dice **"Datos a abril 2026"** con tooltip "Último mes con datos de producción disponibles en la base." (aclarando que NO es fecha de actualización de la página).

### 4. Botón "casita" en la barra de pills (TopBar.jsx)
- Nuevo botón con ícono de casa al inicio de `tih-filterbar__pills-row`, antes de "Actividad petrolera". `onClick` hace `setSeccion(""); setTema(null)` → vuelve a `HomeDashboard` (Panorama general).
- Ajustado a 18×18px de ícono para que la altura del botón (32px) coincida con las demás pills.

### 5. DynamicTable.jsx — Suma por año en vista mensual + fix "Columnas"
- **Nuevo**: en periodicidad Mensual, cada año ahora tiene su propia columna "Suma" al final (antes solo existía en modo Anual).
- **Botón "Columnas"**: en mensual ya NO lista los 12+ meses individuales, solo un checkbox "Suma" para mostrarla/ocultarla. En anual sigue igual (lista de años + Suma).
- **Bug encontrado y corregido**: el bloque viejo de "suma total global" (diseñado para modo anual) no estaba excluido en mensual → generaba una columna fantasma (gran total de todos los años combinados) sin encabezado correspondiente, desalineando la tabla con 2+ años. Fix: agregar `!isMonthly` a esa condición (línea ~989 de `DynamicTable.jsx`).
- **Bug encontrado y corregido**: el dropdown de "Columnas" (`z-20`) quedaba detrás del `thead` sticky de la tabla (`z-index:30`). Fix: subir el dropdown a `z-50`.

### 6. Producción por ubicación (topic "Cuenca")
- **Default de series al cargar**: ahora solo **Petróleo, Condensado y Gas** quedan prendidas (antes las 8: incluía también Hidrocarburos líquidos, Gas asociado, Gas no asociado, Nitrógeno, Agua). Implementado en `useExplorer.js` con `buildProdCuencaVisible()`, que se activa en `setResultado()` cuando `tema.json_arg === "Cuenca"` y no hay `groupBy` activo. Matchea por nombre base (antes del " (unidad)") contra `["Petróleo","Condensado","Gas"]`.
- **Filtro "Producto" eliminado** del drawer de filtros (`ProdDrawer` en `TopBar.jsx`) — la selección de producto ahora se hace únicamente con las chips de series (`SeriesChips` en `ChartArea.jsx`). Se quitó `conProductos` prop, `isProdCuenca` (quedó sin uso), `productos` del estado `prodFiltros` en el store, y el query param `productos` que se enviaba al backend en `useChartData.js`.

## Archivos tocados
- `backend/app/services/pozos_service.py` — `_tendencia()`, `_tendencia_por_pozo()`, `get_pozo_analisis()`, `get_pozos_comparar()`
- `backend/app/routers/produccion.py` — endpoint `/pozos/comparar` con parámetros de período
- `backend/app/services/precios_service.py` — `_get_brent_actual()`, `_get_mme_anterior()` (nueva), `get_indicadores_economicos(engine)`
- `backend/app/services/resumen_service.py` — pasa `engine` a indicadores económicos
- `frontend/src/components/Charts/PozosComparar.jsx`, `PozosExplorer.jsx`
- `frontend/src/api/client.js` — `fetchPozosComparar`
- `frontend/src/components/Header/TopBar.jsx` — botón casita, quitó "Comparar años", quitó filtro "Producto"
- `frontend/src/components/Charts/HomeDashboard.jsx` — indicadores económicos con flechas, reorganización carruseles, Pozos Operando rediseño híbrido, label "Datos a..."
- `frontend/src/components/Charts/DynamicTable.jsx` — suma por año en mensual, fix columna fantasma, fix z-index dropdown
- `frontend/src/store/useExplorer.js` — `buildProdCuencaVisible()`, limpieza `prodFiltros.productos`
- `frontend/src/hooks/useChartData.js` — quitó query param `productos`

## Notas / pendientes
- El `.env` del backend se carga por ruta relativa — al correr scripts sueltos de Python, ejecutar desde `backend/` como cwd o falla el login a SQL Server.
- Los servidores de preview (puerto 5173/8000) a veces quedan ocupados por sesiones previas del usuario — hay que matar el proceso (`Stop-Process`) antes de `preview_start` si eso pasa.
- El PDF didáctico de Tendencia/Vida Remanente (sección 2) no quedó guardado de forma persistente en el repo — si se vuelve a pedir, hay que regenerarlo (el script usaba matplotlib + reportlab, datos reales de MALOOB-433D).
