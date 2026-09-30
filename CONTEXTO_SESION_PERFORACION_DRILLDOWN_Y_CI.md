# Drilldown de pozos en Perforación + CI/CD + pulido UI (2026-08-07)

**Sesión anterior:** `CONTEXTO_SESION_ASIGNACIONES_ANALITICA.md`

## 1. CI/CD automático ya funcionando
Se armó un pipeline de GitLab CI (`.gitlab-ci.yml` en la raíz) usando el
`gitlab-runner` (executor `shell`) ya instalado en el servidor Portales
(`172.16.83.21`, mismo server que corre TIH). Cada push a `master` ahora:
1. `sudo git -C /opt/tih pull`
2. `npm ci && npm run build` (frontend)
3. `sudo chmod -R o+rX /opt/tih/frontend/dist`
4. `sudo systemctl restart tih_backend`

Setup ya hecho en el servidor (no repetir): runner registrado como
`deploy-tih` (token nuevo pedido desde el proyecto TIH en GitLab, con
`--tls-ca-file` para el certificado autofirmado, NO `--tls-skip-verify`, ese
flag ya no existe en `gitlab-runner register` moderno), sudoers con
`gitlab-runner ALL=(ALL) NOPASSWD: /bin/systemctl restart tih_backend` en
`/etc/sudoers.d/gitlab-runner-tih`, grupo `tih-deploy` compartido entre
`mvazquez` y `gitlab-runner` con permisos de escritura en `/opt/tih`.
**Pendiente de esta sesión**: confirmar que el primer pipeline automático
corrió bien end-to-end (se registró el runner y se pusheó el `.gitlab-ci.yml`,
pero no se verificó el resultado del pipeline en la UI de GitLab).

## 2. Bug real encontrado y corregido: join Asignación↔Pozo
`PRODUCCION_POZOS.ASIG_CONT` **no** es el código corto (`"A-0001"`, como en
`PRODUCCION_CAMPOS.ASIG_CONT`) — es `"A-0001-5M - CAMPO ABKATUN"` (código +
sufijo + nombre de campo). El código real siempre es el prefijo exacto de esa
cadena seguido de un guion. Se corrigió en
`get_asignacion_detalle` (`produccion_service.py`) usando `LIKE :asig + '-%'`
en vez de `=`, y `pozos_asociados` ahora devuelve `{pozo, campo}` (el `campo`
completo, necesario para la navegación a Producción por pozo).

## 3. Bug real encontrado y corregido: chips de series en tabla con filtro activo
En `DynamicTable.jsx`, `flattenMultiLevel`/`walk()` solo aplicaba el filtro
`visibleSeries` (chips Petróleo/Condensado/Gas) en el nivel raíz (`applyVis`),
nunca en el nivel Producto cuando había un filtro de Cuenca/Ambiente activo
(ahí se usa `flattenMultiLevel`, no `flattenGroups`). Se agregó el filtro
también quando `lv.key === "categoria"`, sin importar la profundidad.

## 4. Feature nueva: desglose de pozos en Perforación (Actividad petrolera)
Pedido: al ver "7 pozos perforados" en la tabla de `Pozos Perforados`/
`Pozos Terminados`, poder ver cuáles son esos 7 por nombre.
- **Investigación clave**: `dbo.perforacion_pozos_perf`/`_term` son VIEWS
  (no tablas) sobre `cmde_valid.dbo.bd_pozos` (¡NO `cmde_raw.dbo.bd_pozos`,
  que es el catálogo que usa el resto de la app para producción!), agrupando
  por `DRILLING_FINISH_DATE`/`COMPLETION_FINISH_DATE` (mes) y por `TYPE`
  (no por `CATEGORY`). Ver definición real con
  `SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.perforacion_pozos_perf'))`.
- **Backend**: `get_perforacion_pozos_detalle()` en `perforacion_service.py` +
  endpoint `GET /perforacion/pozos-detalle` — replica la lógica de la vista
  en pandas (no confía en el texto exacto del `CASE` SQL). Todos los filtros
  (cuenca/ubicación/operador/categoría) son opcionales: si la celda clickeada
  no distingue esa dimensión (agregada), se omite el filtro y se trae el
  superset, nunca se inventa un valor. También resuelve `campo` (ASIG_CONT
  completo) por nombre contra `PRODUCCION_POZOS`/caché, para poder navegar a
  Producción por pozo — puede salir `null` si el pozo aún no tiene
  producción registrada (perforado hace poco, o resultó improductivo).
- **Frontend**: `DynamicTable.jsx` ganó `onCellClick` (clic en una celda de
  valor, no en toda la fila) + threading de dimensiones activas
  (`_dimUbicacion/_dimCuenca/_dimCategoria`) a través de `walk()` →
  `renderOperators()`, necesario porque esa función no guardaba en qué
  Ambiente/Cuenca/Categoría estaba parada. `ChartArea.jsx` mapea la celda a
  filtros según el `groupBy` activo (la tabla de Perforación puede agrupar
  por Ambiente, Cuenca, Categoría o Nacional según qué filtro esté activo en
  el drawer — cada uno guarda la dimensión en un campo distinto, ver
  `celdaAFiltroPerforacion()`). Nuevo componente
  `PerforacionPozosDetallePanel.jsx` (modal centrado, mismo estilo que
  `AsignacionDetallePanel`) — cada pozo es clickeable, con badge "Sin
  producción" si no tiene `campo` resuelto.
- **Navegación a pozo sin producción**: `PozosExplorer.jsx` ahora acepta
  `pendingPozoSelection` con `campo: null` — en ese caso no dispara fetch y
  muestra una pantalla dedicada "Pozo sin producción registrada" con un
  video en loop (`frontend/public/pozo-sin-produccion.mp4`, actualmente
  fondo blanco `rgb(242,242,242)` horneado en los píxeles — el componente
  `VideoSinFondo` hace croma-key en vivo por canvas, `UMBRAL=18` contra ese
  color exacto). **Si se reemplaza el archivo de video, subir el número de
  `?v=N` en el `<VideoSinFondo src=".../pozo-sin-produccion.mp4?v=N">`** —
  si no, el navegador puede seguir sirviendo la versión vieja desde caché
  (ya pasó en esta sesión, causó confusión).

## 5. Ranking de Asignaciones — rediseño completo
`AsignacionesRanking.jsx`: ahora Top 15 con podio (top 3, tarjetas al mismo
nivel, orden 1-2-3 izquierda a derecha, con medallero oro/plata/bronce) +
tabla para el resto, degradado diagonal verde/azul según el switch Mbd/MMpcd
(verde = Mbd, azul = MMpcd, mismo color en podio/tabla/hover). Se quitó el
botón "Volver" que se había agregado (al usuario no le gustó visualmente) —
la navegación cruzada a Producción por pozo/campo sigue funcionando sin él.

## 6. Panel de detalle de Asignación — mejoras acumuladas
`AsignacionDetallePanel.jsx`: modal centrado (antes era drawer lateral) con
tabla de producción (todos los productos, no solo líquidos+gas) con switch
Tabla/Gráfico (Gráfico deshabilitado en vista mensual, se ve muy amontonado),
hover que ilumina toda la fila, mensaje "Seleccione un rango mayor a un año"
si solo hay 1 período. Campos asociados y pozos asociados son clickeables:
navegan a Producción por campo / Producción por pozo respectivamente (vía
`pendingBusqueda`/`pendingPozoSelection` en `useExplorer.js`).

## 7. Ajustes de texto pedidos explícitamente esta sesión
- "Período" → "Periodo" (sin acento) en toda la UI.
- "petroleo" → "petróleo": el nombre de los temas viene tal cual de la
  columna `TEMA` de la tabla `CUBOS` en la BD, **sin acentos** — no se tocó
  la BD, se corrige solo en pantalla en `TopBar.jsx`
  (`t.tema.replace(/petroleo/gi, "petróleo")`). Si aparecen más typos de
  acentos en nombres de tema, es de ahí de donde vienen.
- Línea/etiqueta "Reforma Energética" en 2014 quitada de las gráficas
  (`ChartArea.jsx`, dentro de `buildChartOption`).
- "PANORAMA GENERAL" (home) reemplazado por "DATOS A {MES} DE {AÑO}"
  calculado del período más reciente con datos.

## 8. Pendiente / sin verificar al cierre de esta sesión
1. Confirmar visualmente que el primer pipeline de GitLab CI corrió bien
   (build + deploy) tras el push de `.gitlab-ci.yml`.
2. Video "pozo sin producción": confirmar que el usuario ve la versión
   correcta tras el `?v=3` (puede necesitar otro bump de versión si vuelve a
   cambiar el archivo).
3. Nada de lo de puntos 4-7 se ha comiteado/pusheado todavía — confirmar con
   el usuario antes del próximo push grande (regla ya establecida en
   sesiones previas: agrupar cambios, avisar antes de operaciones de red).
4. `backend/scratch_asignaciones_query.sql` sigue sin comitear a propósito
   (es un archivo de diagnóstico, no código de la app).
