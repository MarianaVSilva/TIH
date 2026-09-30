# UI Polish & Cache Auto-Refresh — 2026-07-15 (segunda parte)

**Sesión anterior:** `CONTEXTO_SESION_POZOS_ANALITICA_LOCAL.md` — todo OK, backend local + caché + analítica Pozos.

## Cambios

### 1. Cache auto-refresh (sin botón manual)
- **Backend** `pozos_cache.py`: agregué `maybe_auto_refresh()` → refresca solo si: nunca sincronizado O pasó >24h desde último refresco.
- **Backend** `main.py`: en `@app.on_event("startup")` dispara `pozos_cache.maybe_auto_refresh()` — silent, background, no bloquea arranque.
- **Frontend**: eliminé `refrescarPozosCache` fetcher + botón "Actualizar" de `PozosExplorer.jsx`.
- **UI** `CacheBanner`: ahora solo muestra aviso pasivo cuando `status=="sincronizando"`, sin botón (dot pulsante + texto).
- **Result**: usuario no tiene que hacer nada; caché se mantiene solo.

### 2. Buscador legible
- **Problema**: texto blanco en fondo blanco → invisible.
- **Fix** `PozosExplorer.jsx` + `PozosFiltrosPanel.jsx`: agregué `text-slate-700 placeholder:text-slate-400` a inputs.

### 3. Mapa geográfico eliminado
- **Borré**: `PozoCampoScatter.jsx` (archivo completo).
- **Borré**: `GET /produccion/pozos/scatter` endpoint (`produccion.py`).
- **Borré**: `get_campo_scatter()` función (`pozos_service.py`).
- **Borré**: `fetchPozosScatter` fetcher (`client.js`).
- **Borré**: render de `<PozoCampoScatter/>` en `PozosExplorer.jsx`.
- **Result**: vista de campo muestra solo ranking + KPIs (sin scatter lat/long).

### 4. Rediseño PozoRankingCard
**Problema**: gráfico ECharts con barras top/bottom + tabla, pero:
- Si hay 1 pozo de 1.75 Mbd y otros de 0.05, el gráfico machacaba visualmente la escala.
- Tooltip se comía el título.

**Solución**: eliminar ECharts, usar mini-barras HTML con escala proporcional **por grupo**:
- **Top productores** (verde): barras mini proporcionales entre sí.
- **Menor producción** (ámbar): barras mini proporcionales entre sí (escala independiente).
- **Tabla** debajo: filas alternadas, badges de tendencia (con fondo color), puntos de estado operativo.
- **Hover**: fondo teal-100/80, borde izquierdo teal-500, nombre en teal oscuro.

**Cambio visual**: degradado oscuro (#10312B) en encabezado, mejor contraste, más vistoso.

## Verificado en navegador real
- Buscador: texto visible (slate-700).
- Cache banner: no aparece botón "Actualizar", solo aviso mientras sincroniza.
- Mapa: eliminado, ranking visible sin scatter.
- Ranking: mini-barras legibles, hover resalta fila con borde teal fuerte.
- Red traffic: sin llamadas a `/scatter` endpoint.

## Archivos tocados
- `backend/app/services/pozos_cache.py`: `maybe_auto_refresh()`
- `backend/app/main.py`: `@app.on_event("startup")` call
- `backend/app/routers/produccion.py`: borré endpoint `/pozos/scatter`
- `backend/app/services/pozos_service.py`: borré `get_campo_scatter()`
- `frontend/src/api/client.js`: borré `fetchPozosScatter`, borré `refrescarPozosCache`
- `frontend/src/components/Charts/PozosExplorer.jsx`: borré import `PozoCampoScatter`, borré render, quitó `scatter` state, quitó `setRefrescando`/`iniciarRefresco`/`pollRef`
- `frontend/src/components/Charts/PozosFiltrosPanel.jsx`: inputs ahora `text-slate-700 placeholder:text-slate-400`
- `frontend/src/components/Charts/PozoRankingCard.jsx`: **reescrito**
  - Eliminé ECharts gráfico
  - Agregué `TendenciaBadge`, `EstadoBadge`, `MiniBarList` helper components
  - Encabezado con gradiente oscuro
  - Dos columnas (top/bottom) con barras proporcionales
  - Tabla con hover interactivo (teal-100/80 bg, borde izquierdo teal-500)

## Próximos pasos (si aplica)
- Ningún bloqueo conocido.
- Caché se refresca automáticamente al arrancar el backend.
- Todo en Pozos es interactivo (filtros, comparar, ranking, detalle) sin UI manual.
