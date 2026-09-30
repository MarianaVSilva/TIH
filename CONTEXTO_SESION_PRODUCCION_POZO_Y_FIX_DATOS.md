# Contexto de sesión — Fix de datos inflados + "Producción por pozo"

Fecha: 2026-07-15

## Parte 1 — Bug crítico: datos de Producción ~12x inflados

**Síntoma:** valores anuales de Producción muy por encima del SIH (ej. Hidrocarburos líquidos 20,699.92 Mbd portal vs 1,725.1 SIH).

**Causa:** Mbd/MMpcd son tasas diarias, no volúmenes acumulados. La vista "Anual" sumaba las 12 filas mensuales en vez de promediarlas — confirmado matemáticamente: suma de los 12 meses = 20,699.91 (el bug), promedio = 1,724.99 (coincide con SIH).

**Fix:** nuevo helper `_rollup_periodo(df, entity_cols, value_cols)` en `produccion_service.py` (y copias en `contratos_service.py`, `estado_service.py`) que:
1. Suma entidades dentro del **mismo mes** (varios campos/contratos/operadores en paralelo sí se suman).
2. **Promedia** entre meses cuando el período abarca varios (vista anual).

Aplicado en: `get_produccion_cuenca`, `get_produccion_campos`, `get_produccion_api`, `get_produccion_asignaciones`, `get_produccion_operadores`, `get_produccion_gcompo`, `contratos_service.get_contratos/get_operadores`, `estado_service.get_por_estado`. Verificado tras el fix: todos los valores coinciden con SIH (±0.1%).

## Parte 2 — Nuevo tema "Producción por pozo" (json_arg `Pozos`)

Antes no implementado (memoria previa lo marcaba pendiente). Requería SIH-style drill-down: Cuenca→Campo(Asig_Cont)→Pozo, tabla `dbo.PRODUCCION_POZOS` (~3.4M filas, granularidad UWI, sin índice eficiente — cualquier query tarda ~5-6s de piso).

**Intentos descartados (por lentitud):**
- Traer todos los pozos con valores en una sola tabla jerárquica → timeout incluso a 90s a nivel nacional.
- Preseleccionar todas las cuencas de inicio → mismo problema.

**Solución final — diseño de dos pasos (igual que el SIH original):**
1. `GET /produccion/pozos/arbol` — árbol Cuenca→Campo→Pozo **sin cifras**, filtrado a actividad de los últimos 2 años. ~6s primera vez, cacheado después.
2. `GET /produccion/pozos/detalle?campo=&pozo=` — serie de UN pozo puntual, bajo demanda al hacer clic. ~5-6s por pozo nuevo, cacheado después.
3. `GET /produccion/pozos/resumen?cuenca=|campo=` — KPIs agregados (7 productos + conteo de pozos activos) del nivel seleccionado en el árbol, para ver de un vistazo si una cuenca/campo es productor de gas o de aceite.

**Frontend:** nuevo componente `frontend/src/components/Charts/PozosExplorer.jsx` — panel izquierdo con árbol colapsable + buscador, KPIs dinámicas arriba (verde=líquidos, naranja=gas, azul=agua), panel derecho con tabla del pozo seleccionado. `ChartArea.jsx` renderiza este componente directo para `json_arg==="Pozos"` (bypassa el flujo genérico de `resultado`/`useChartData`, ya que maneja su propio fetch en 3 pasos).

**Limpieza:** se revirtieron y eliminaron todos los intentos previos descartados (filtro por cuenca en drawer, modo `pozosView` en `DynamicTable.jsx`, endpoint `/pozos/filtros`) — no quedó código muerto.

## Archivos tocados
- `backend/app/services/produccion_service.py` (rollup fix + 3 funciones nuevas de Pozos)
- `backend/app/services/contratos_service.py`, `backend/app/services/estado_service.py` (rollup fix)
- `backend/app/routers/produccion.py` (3 endpoints nuevos: `/pozos/arbol`, `/pozos/detalle`, `/pozos/resumen`)
- `frontend/src/components/Charts/PozosExplorer.jsx` (nuevo)
- `frontend/src/components/Charts/ChartArea.jsx` (branch para Pozos)
- `frontend/src/hooks/useChartData.js` (Pozos no pasa por el flujo genérico)
- `frontend/src/api/client.js` (3 fetchers nuevos)

## Pendiente / no cubierto esta sesión
- Otros temas de Producción (Contratos detalle por número, Estado con gas asociado/no asociado) siguen con las brechas ya documentadas en `CONTEXTO_SESION_PRODUCCION.md`.
- No se hizo revisión visual comparativa exhaustiva contra SIH de todos los temas tras el fix de rollup — solo verificación numérica puntual.

## Cómo levantar el entorno local
```cmd
cd backend && py -3 -m uvicorn app.main:app --port 8000
cd frontend && npm run dev
```
Backend sin `--reload`: reiniciar manualmente tras cambios en Python.
