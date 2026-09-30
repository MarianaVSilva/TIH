# Responsivo móvil + Analítica de Asignaciones (2026-08-04/05)

**Sesión anterior:** `CONTEXTO_SESION_DESPLIEGUE_LINUX.md`

## 1. `.env` local apunta ahora al servidor REAL (no local)
`backend/.env`: `DB_SERVER=172.16.200.99`, `DB_INSTANCE=UMBRACODB`,
`DB_USER=estadistica`, password ya puesta por el usuario (no repetir aquí).
Antes apuntaba a `localhost` (BD local de desarrollo).

## 2. `.claude/launch.json` — el backend NO tenía `--reload`
Bug de proceso que costó una sesión larga de debugging: el backend arrancaba
con `uvicorn app.main:app --port 8000` **sin** `--reload`, así que ningún
cambio de código se aplicaba hasta matar y reiniciar el proceso a mano — se
veían resultados "viejos" pensando que eran bugs de lógica. Ya se agregó
`--reload` al comando en `launch.json`. **Lección**: si algo no refleja un
cambio reciente, sospechar primero del proceso antes que del código.

## 3. Bug real encontrado: `PLAN` es palabra reservada en SQL Server
Las queries a `entitlements.v_general_info` que pedían la columna `PLAN` sin
corchetes tronaban con error de sintaxis — quedaba atrapado por un
`try/except Exception: return {}` silencioso, así que el síntoma era
"vuelve todo null" sin ningún error visible. Corregido con `[PLAN]` en
`produccion_service.py` (2 lugares: `get_asignaciones_ranking` y
`get_asignacion_detalle`).

## 4. Tabla `entitlements.v_general_info` (catálogo de asignaciones/bloques)
Confirmada como el equivalente a `BD_POZOS` pero para asignaciones. Vive
detrás de un **linked server** (`UATAC_SISEAA`) — solo resuelve desde el
servidor real, nunca desde una BD local de desarrollo (degradar con gracia,
no truena).

Columnas: `BLOCK_ID` (= `ASIG_CONT`), `BLOCK_NAME` (nombre legible, ej.
`"A-0001-6M - Campo Abkatún"`), `BLOCK_TYPE/SUBTYPE`, `PLAN`, `ACTIVITY`,
`ENVIRONMENT`, `BASIN`, `VALIDITY`, `START_DATE`/`END_DATE`/`EFFECTIVE_DATE`,
`AREA_KM2`, `DEPTH`.

Join `BLOCK_ID = ASIG_CONT` cubre ~98.5% de los contratos reales (392/398
distintos). El resto son 6 códigos `ADM-E-*` + una fila literal `"asignaciones"`
+ `ASIG_CONT` nulo — confirmado con el usuario que son registros
administrativos nuevos, no bloques reales (se excluyen del ranking).

## 5. Feature nueva: Analítica de Asignaciones
- **Backend** (`produccion_service.py`):
  - `_mapa_asig_a_block_name(engine)`: helper ASIG_CONT→BLOCK_NAME, usado para
    sustituir el código por el nombre en la tabla normal de "Producción por
    Asignación" (`get_produccion_asignaciones` → `_drilldown_ambiente_cuenca_producto`
    → `_filas_producto_hoja`, todas con `nombre_map` opcional; `_make_row`
    ahora acepta `code=` para conservar el ASIG_CONT original junto al label).
  - `get_asignaciones_ranking`: ranking por producción + atributos del bloque
    + `productividad_mbd_km2` (líquidos/área). Endpoint `GET /produccion/asignaciones/ranking`.
  - `get_asignacion_detalle`: operador, campos, pozos asociados (vía
    `pozos_service`, import local para evitar circular import), fecha de
    construcción (perforación más antigua), serie propia de producción.
    Endpoint `GET /produccion/asignaciones/detalle?asignacion=...`.
- **Frontend**:
  - `AsignacionesRanking.jsx`: tabla ranking con buscador + filtro vigentes.
  - `AsignacionDetallePanel.jsx`: panel flotante lateral con los datos +
    gráfica, se abre al hacer clic en una fila de asignación en la vista de
    tablas (`DynamicTable` ahora soporta `onRowClick` + `row._code`).
  - Pestaña "Ranking" en `ViewBar` (antes decía "Analítica"), solo visible en
    el tema Asignaciones.
- **Filtro de Producción por Operador** (`TopBar.jsx` `ProdDrawer`): ahora
  además del pastilla Todos/Pemex/Privados hay checkboxes de empresa
  individual (`prodOpciones.empresas`, nueva query a `PRODUCCION_OPERADOR_IP`
  en `get_produccion_filtros`). Grupo + empresas se **combinan** (OR, no AND)
  — `get_produccion_empresas` ahora acepta `empresas=` además de `grupos=`.

## 6. Fixes de responsivo móvil (primera mitad de la sesión)
Muchos ajustes en `HomeDashboard.jsx`, `DynamicTable.jsx`, `App.jsx`,
`ChartArea.jsx`, `TopBar.jsx`: contenedores con `min-w-0`/`min-h-0` faltantes
causaban overlap y overflow horizontal en pantallas chicas; columna sticky de
nombre pasa a estática (`static sm:sticky`) en móvil; búsqueda jerárquica
(`flattenMultiLevel`) ahora filtra en cualquier nivel (antes solo hoja).

## 7. Reglas de "redundancia" en tablas jerárquicas (pedido explícito)
Cuando una categoría/subtotal tiene un solo hijo, su cifra es idéntica a la
del hijo de abajo — pero solo es redundante mientras esté **expandida**
(visible el hijo). Colapsada, se muestra la cifra (es la única visible).
Aplica en `pushOperatorRows` (`soloUnHijo = visible.length===1 && isOpenSub`)
y en `flattenMultiLevel` (`esRedundante = pendingLabels.length===0 && isOpen`).

## 8. Totales Mbd/MMpcd (todos los temas de Producción)
`mostrarTotalesUnidad` en `DynamicTable.jsx` ahora es simplemente
`= forceDivisions` (ya cubría exactamente los temas correctos: Cuenca,
Contratos, Campos, Asignaciones, Estado, Gcompo, Operadores). Filas
`totalmbd`/`totalmmpcd` (azul/naranja) ocultables con botón de ojito en el
Toolbar, aplicado tanto en `flattenGroups` como en `flattenMultiLevel`.

## 9. Pendiente / sin verificar
1. Verificar visualmente en navegador (no se pudo tomar screenshot esta
   sesión, panel del navegador no visible) — pedir al usuario captura de
   Ranking + panel de detalle con datos reales del servidor 99.
2. `pozos_asociados`/`fecha_construccion` en el panel de detalle salieron
   vacíos en las pruebas (posible que `PRODUCCION_POZOS`/caché no tenga
   overlap con los `ASIG_CONT` probados, o falte revisar `pozos_cache.py`
   `_source_table()` en el servidor real) — confirmar con datos reales.
3. Considerar agregar `entitlements` como fuente documentada en
   `DATABASE_SCHEMA.md` (no se hizo esta sesión).
4. Recordar: no comitear/pushear sin avisar antes (regla ya establecida en
   sesión previa). Nada de esta sesión se ha comiteado todavía.
