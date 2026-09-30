# Reservas por campo / por asignación-contrato — 2026-08-14

## 1. Unificación de temas (antes 3 temas separados por hidrocarburo)
- "Reservas por campo de petróleo/gas/pce" → **un solo tema "Reservas por campo"** (json_arg fijo `ReservasP`; G/PCE ocultos del menú en `temas_service`/`TopBar.jsx`).
- Igual para "Reservas por asignación-contrato" (json_arg `ReservasAsigP`).
- 3 pestañas internas **Aceite/Gas/PCE** arriba de la tabla (`ChartArea.jsx`) que pisan el `tipo` real enviado al backend — estado en `useExplorer.reservasTipo`/`setReservasTipo`. `useChartData.js` decide `tipo` real según `RESERVAS_CAMPO_TIPOS`.
- Nombres de tema acentuados/renombrados solo en frontend (`acentuarTema` en TopBar.jsx), sin tocar la BD.

## 2. Backend (`backend/app/services/reservas_service.py`)
- `get_reservas_por_campo`: tabla `RESERVAS_CAMPOS`. Jerarquía Total general → Cuenca → Ambiente → Campo → 1P/2P/3P (acumulados de PROBADAS/PROBABLES/POSIBLES). Campos con 1P=0 al inicio del rango se omiten de la lista (no de las sumas).
- `get_reservas_asignacion_contrato` (nueva): tabla `dbo.reservas_asig_cont` (columna `tipo` ya viene como '1P'/'2P'/'3P', no hay que acumular). Clasifica por prefijo del código: `A-...` = **Asignaciones**, cualquier otro (`CNH-...`, `R01L02`...) = **Contratos** — nunca se mezclan, son 2 grupos top-level separados. Nombre completo del bloque via join con `dbo.reservas_asig_cont_campos` (`asignacion_contrato_nombre`) — ojo: algunos códigos existen en el catálogo con nombre NULL (usar `nombres.get(x) or x`, no `.get(x, x)`).
- Asignaciones anida Cuenca como subtotal intermedio (son ~400+ items); Contratos va directo sin Cuenca (son pocos).

## 3. `DynamicTable.jsx` — cambios generales (afectan cualquier topic con groups multi-subgrupo)
- **Bug corregido**: `flattenGroups` groupBy="cuenca" solo leía `g.subgroups[0]`, perdiendo datos de todos los Ambientes salvo el primero. Ahora usa `flatMap` de todos los subgroups.
- Filas de grupo colapsadas ahora muestran su total agregado (`g.data`) cuando cerradas, se ocultan al abrir (antes siempre null).
- **Cuenca como cabecera colapsable de 3 estados** (solo cuando `forceDivisions` y el subtotal no trae operator rows propios — patrón exclusivo de Asignaciones): clic 1 abre con detalle 1P/2P/3P de cada item, clic 2 colapsa el detalle (dentro de esa Cuenca) dejando solo nombre+valor por item, clic 3 cierra todo. Un item individual sigue siendo clickeable para reabrir su detalle aun en estado 2. Lógica en `cycleCuenca()` + flags `saltandoCuenca`/`ocultarDetalleItems`/`dentroDeCuenca` dentro de `pushOperatorRows`.
- Nuevo tipo de fila `subtotalcuenca` (fondo mint `bg-teal-50/70`) + indentación (`_indent`) para que los items se vean claramente anidados bajo su Cuenca.
- Doble clic ya no colapsa filas de más (se ignora `e.detail > 1` en el onClick de fila).
- Prop nuevo `sinResumen`: oculta la cifra de las filas de resumen (Total general/Asignaciones/Contratos/Cuenca) — activo solo para `esReservasAsig` (esos números sumaban 1P/2P/3P de forma que el usuario consideró engañosa). El item individual sí sigue mostrando su propio valor.
- Prop `search`/`onSearchChange` controlados (antes estado interno) — para que la búsqueda sobreviva el remount al cambiar de pestaña Aceite/Gas/PCE (`ChartArea` pasa por `loading` brevemente y desmonta la tabla).

## 4. `ChartArea.jsx` — UI de Reservas
- Colores fijos por hidrocarburo en toda la sección (tabla, cascada, círculos): **1P verde `#22c55e`, 2P azul `#3b82f6`, 3P naranja `#f97316`** (colores de tabla/cascada NO cambian por pestaña). Para los **círculos** sí hay paleta por pestaña: Aceite=naranjas, Gas=azules, PCE=verdes (`RESERVAS_CIRCULOS_PALETAS`).
- **Cascada** (`ReservasWaterfallChart`): top 8 campos/items por 3P, barras apiladas horizontales, sin cifras fijas (solo tooltip al hover). Eje X con nombre de unidad centrado bajo el eje (`nameLocation:"middle"`) — antes se recortaba con `left` fijo; ahora `grid.containLabel:true` deja pasar nombres largos sin cortarlos, en toda la sección.
- **Círculos** (`ReservasCirclesChart`): mismo centro (concéntricos, todos dentro del más grande), radio ∝ raíz del valor. Etiqueta (tag+valor+unidad) apilada verticalmente encima del centro, en Noto Sans (no Patria).
- **"Gráfica personalizada por cuenca"** (rebautizada **"por modalidad"** solo para asignación-contrato): cascada con TODAS las cuencas/modalidades (ordenadas de mayor a menor 3P), buscador de texto simple que filtra cuáles se ven (no selector único). Sin fila de pills de sumatoria (se quitó).
- **"Gráfica personalizada por campo"** (o "por asignación/contrato"): selector buscable + toggle Círculos (default)/Cascada. La selección persiste entre pestañas Aceite/Gas/PCE vía `useExplorer.reservasCampoSel`.
- **"Generar reporte"**: faltaba en Reservas, ya está. Usa `contentRef` (ahora envuelve el contenido de esta rama) + `buildReservasTabla` (exportador propio, NO reutiliza `buildPivotExport` porque ese suma items dentro de Ambiente/grupo perdiendo el detalle real — bug ya corregido). Columnas: campo → `[Cuenca, Ambiente, Campo, Año, 1P/2P/3P (unidad)]`; asignación-contrato → `[Modalidad, Cuenca, Ambiente, item, Año, 1P/2P/3P (unidad)]` (Cuenca es "—" para Contratos, que no la guarda).

## Gotchas de esta sesión
- ECharts **no renderiza contenido visible** en el navegador de preview de este entorno sandbox (contenedor queda vacío, sin canvas/svg) — no es un bug del código, se verificó comparando con gráficas ya existentes sin tocar. Verificación de gráficas en esta sesión fue por inspección de DOM/atributos (`circle r=`, `viewBox`, etc.), no visual.
- `read_console_messages` a veces devuelve un buffer viejo cacheado (mismo timestamp exacto en llamadas separadas) — para confirmar de verdad, revisar el DOM directamente (`document.body.innerText`) en vez de confiar ciegamente en ese log.
- Nada de esto está commiteado/pusheado todavía — el usuario no ha confirmado el push final en esta sesión.
