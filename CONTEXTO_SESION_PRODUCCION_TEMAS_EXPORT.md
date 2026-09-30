# Producción — rediseño de temas, gráficas, expandir/contraer, export (2026-07-29)

**Sesión anterior:** `CONTEXTO_SESION_PRODUCCION_OPERADOR.md`

## 1. Diseño uniforme "Nacional → Producto → hoja"
Backend `produccion_service.py` — helpers genéricos reusados por varios temas:
- `_filas_por_producto_entidad(df, entidad_col, categories)` / `_series_por_producto` / `_kpis_producto_entidad` / `_cargar_df_producto_entidad` / `_respuesta_producto_entidad`: Nacional plano → Producto (subtotal) → hoja.
- `_cargar_df_producto_entidad_multi` + `_filas_producto_hoja` + `_drilldown_ambiente_cuenca_producto`: drill-down Ambiente→Cuenca→Producto→hoja (Campo/Asignación cuando se filtra).
- `_entidades_series_por_producto`: por-entidad series para "Gráfica personalizada" (usado por Contratos → campo `contratos` en la respuesta).

**Por tema:**
- `Contratos` (`get_produccion_contratos`): Nacional→Producto→Contrato (TIPO='CONTRATO'), siempre plano (sin filtro de cuenca/ambiente, no aplica). Devuelve `contratos: [{nombre, series}]`.
- `Campos` (`get_produccion_campos`): sin filtro = Nacional→Producto→Campo (como antes). Con Ambiente/Cuenca filtrado = drill-down 4 niveles Ambiente→Cuenca→Producto→Campo.
- `Asignaciones` (`get_produccion_asignaciones`): igual patrón que Campos pero hoja = ASIG_CONT (TIPO='ASIGNACION'), sin filtro hoja=Cuenca.
- `Estado` (`get_produccion_estado`): jerarquía FIJA Entidad Federativa (grupo, como "empresa" en Operadores) → Producto (subtotal) → Ambiente (hoja). `_hierarchia_entidad_producto`. Siempre groupBy="cuenca" en frontend (ver TopBar.jsx), sin nodo "Nacional", sin filtro.
- `Gcompo` (componentes de gas): sin filtro = Nacional sin clasificar (comportamiento original, plano). Con Ambiente/Cuenca filtrado = drill-down Ambiente→Cuenca→Componente (`_filas_gcompo_detalle`).
- `Cuenca` ("Producción por ubicación"): vista inicial ahora arranca con **ambas** categorías de filtro (Cuenca Geológica + Ambiente) prendidas por defecto (TopBar.jsx efecto `tema.json_arg==="Cuenca"`), i.e. entra directo al drill-down completo.
- Se **quitó** el tema "Producción por Interés de Participación" (`temas_service.py`, excluido de la query SQL de `CUBOS`).

**Bug de datos corregido**: `PRODUCCION_ESTADO` SÍ tiene las 8 columnas de producto (doc `DATABASE_SCHEMA.md` desactualizado decía que solo Petróleo/Condensado/Gas) — confirmado por query directa.

## 2. Frontend — filtros compartidos entre temas (bug importante)
`prodFiltros` (cuencas/ubicaciones) es estado **compartido** en `useExplorer.js`, pero significa cosas distintas por tema (cuencas geológicas reales en Cuenca/Campos/Asignaciones/Gcompo vs. Grupo Pemex/Privadas en Operadores). Al poner default "todo prendido" en Cuenca, se filtraba mal Operadores al cambiar de tema. Fix en TopBar.jsx: efecto que limpia `prodFiltros` a `{cuencas:[],ubicaciones:[]}` al salir de "Cuenca" (salvo que el tema destino sea Cuenca de nuevo).

`PRODUCCION_HIER_TOPICS` (TopBar.jsx) = temas con drawer de Filtros Cuenca/Ambiente: Cuenca, API, Operadores, Gcompo, Campos, Asignaciones. `PRODUCTO_FLAT_TOPICS` = solo Contratos (sin filtro posible). Estado no está en ninguno (groupBy="cuenca" fijo, sin drawer).

## 3. DynamicTable.jsx — mecanismo de colapsar/expandir (reescrito, importante)
- **"openGroups"** (Set) tiene DOS convenciones opuestas según la fila: "open-keys" (isOpen = `openGroups.has(key)`, usado por filas tipo cuenca/planheader de empresa) vs "closed-keys" (isOpen = `!openGroups.has(key)`, usado por planheader multinivel `ml/...` y por productos colapsables `sub|...`).
- `toggleAllGroups()` es ahora **genérico**: para cada fila renderizada con `_groupKey`, deduce su convención comparando `prev.has(key) === row._open`, y decide agregar/quitar la key según eso — funciona igual sin importar la mezcla de niveles.
- Al **expandir todo**, además limpia TODAS las keys con prefijo `ml/` y `sub/` (no solo las visibles), porque un nivel cerrado nunca renderiza a sus hijos y sus keys nunca aparecerían en `rows` para poder abrirlas.
- Fila envoltorio interno **"Nacional"** (`_type==="ubicacion"`, label "Nacional", usada en Contrato/Campo/Operadores-sin-filtro): es solo un gate estructural, **no colapsable por clic directo** (`isCollapse` excluye este caso) y **excluida de toggleAllGroups** (nunca se cierra) — si se cerraba, escondía TODAS las categorías de producto de un tirón. También excluida del cómputo de `hasOpenGroups`.
- Botón "Contraer/Expandir todo" — **posición**: SIEMPRE junto a la etiqueta de la fila padre, nunca en el header de columna (`showHeaderToggle`/`ToggleTodoBtn`):
  - Si hay fila `banner` (Cuenca/Gcompo con Nacional): el botón vive ahí.
  - Si hay `rowHeaderLabel` (Operadores filtrado a 1 grupo, ej. "Privados"): el botón va en el `<th>` junto a esa etiqueta.
  - Si ninguno (Contrato/Campo/Asignación sin filtro): junto a la primera fila VISIBLE (`primeraFilaVisibleIdx`, calculado excluyendo la fila "cuenca" cuando `cuencaCount===1`).
- Subtotales de producto ahora son colapsables (`_type: "subtotalcol"`, key `sub|${gk}|${label}`) — aplica a Contrato/Campo/Operadores/etc.
- Punto 1 (sesión anterior): si un subtotal de producto tiene un único hijo visible, se oculta la cifra repetida (queda solo la etiqueta).
- Buscador: placeholder configurable por prop `searchPlaceholder` (Campo="Buscar Campo", Asignación="Buscar Asignación", default="Buscar Operador o contrato"). Búsqueda por nombre de empresa/cuenca real auto-expande el resultado.

## 4. ChartArea.jsx — "Gráfica personalizada" (reemplaza "Por cuenca", quitado)
- `exportChartPng(chartRef, {titulo, filename})`: función COMPARTIDA para exportar cualquier chart a PNG — banner con degradado verde + logo `/logosener-blanco.png` + título, tamaño fijo apaisado 1000×560 (NO cuadrado — pedido explícito del usuario). Todo PNG futuro debe reusar esta función.
- `SearchableSelect({options, value, onChange})`: combobox buscable COMPARTIDO (reemplaza todos los `<select>` nativos de "Gráfica personalizada") — input de texto que filtra en vivo + navegación por teclado (↓/↑ mueve resaltado, Enter selecciona, Escape cierra). Usado por `OperadorCustomChart`, `CuencaCustomChart`, `ContratoCustomChart`. Cualquier "Gráfica personalizada" nueva debe usar este mismo componente.
- `OperadorCustomChart` (empresas), `CuencaCustomChart` (ubicaciones/ambientes, usa `buildUbicacionSeries`), `ContratoCustomChart` (contratos, usa `resultado.contratos` del backend) — mismo patrón: selector buscable + botón "Exportar PNG".
- `buildOperadoresComparacion` + `OperadorComparacionChart`: vista GENERAL de Operadores (no personalizada) = un mini-gráfico por producto comparando Pemex vs Privados.
- Flags clave en el render: `esOperadores`, `esEstado`, `esCuencaTopic`, `esContratosTopic`, `esProductoNivelForzado` (Campos/Asignaciones), `esDrilldownForzado` (= `esProductoNivelForzado && hayFiltroCuencaUbic`, fuerza nivel "Producto" vía `categorias:["_producto"]` en `filtrosActivos` para activar el multinivel de 4 niveles).
- **Bug corregido**: con Campo/Asignación filtrados (drill-down activo), las chips de "Series" se llenaban con nombres de campo/asignación en vez de productos — `buildProdCuencaSeries` leía la hoja como si fuera la serie. Fix: cuando `esDrilldownForzado`, usar `resultado.series` (ya viene 1 item por producto del backend) en vez de derivarlo de `groups`.
- `useChartData.js`: lista `esProdHier` que decide si se mandan params `cuencas`/`ubicaciones` al backend — debe incluir TODOS los temas con drill-down: Cuenca, Campos, API, Operadores, Gcompo, Asignaciones. (Bug ya corregido: Gcompo y Asignaciones faltaban, sus filtros nunca llegaban al backend.)

## 5. Exportar — CSV → Excel con branding (temas de Producción)
`frontend/src/utils/exportCsv.js` (`descargarCsvConHeader`): usado SOLO por tablas fuera de Producción (Reservas/Precios/Inversiones/Licitaciones vía `DataTable` en ChartArea.jsx) — CSV plano con encabezado de texto (título institucional + tema + período + fecha), sin logo (CSV no soporta imágenes).

**Para los temas de Producción (`DynamicTable.jsx`)** se cambió el botón "Exportar CSV" → **"Exportar Excel"**, reusando `frontend/src/utils/exportExcel.js` → `exportarProduccionExcel()` (la misma función que ya usaba Pozos — el usuario dio ese .xlsx como ejemplo a seguir):
- Banner real con logo de Energía + "TIH — Tablero de Información de Hidrocarburos" + "Secretaría de Energía", igual al header del sitio.
- Metadatos: título del tema, **"Filtros — ..."** (Cuenca Geológica/Ambiente/Grupo/Búsqueda activos, o "Sin filtros (vista Nacional)"), período, fecha de exportación.
- Tabla = exactamente lo que se ve en pantalla: usa `rows` (respeta colapsado/expandido, búsqueda, series ocultas), con sangría por nivel (`nivelDeFila`) para conservar la jerarquía visual (label indentado con espacios).
- **Sin gráficos** (chartImageBase64 se omite explícitamente — pedido del usuario).
- Función `exportExcel()` vive en el componente principal de `DynamicTable` (no en `Toolbar`, porque necesita `filtrosActivos`, `rowHeaderLabel`, `search`, `displayCats`, `rows`); se pasa a `Toolbar` como prop `onExportExcel`. `Toolbar` tiene estado `exportando` (deshabilita el botón mientras exporta, label "Exportando…").

## 6. HomeDashboard.jsx (Panorama general) — layout fijo, sin scroll
- Bug: la card dinámica (carrusel "Top Campos" ↔ "Producción por Operador") no tenía `min-height: 0` en su fila de grid — un flex item sin eso se niega a encoger por debajo del contenido intrínseco, así que el slide más alto (Producción por Operador, con dona+listas) empujaba "Pozos operando" fuera del viewport, forzando scroll de toda la página. Fix: `minHeight: 0` en el grid wrapper + `overflow: hidden` en el Card del carrusel (clip en vez de reflow).
- Ajuste estético pedido: cards de arriba (Producción/Mercado) un poco más chicas (cifras 40px→33px, menos padding), fila de en medio con un poco más de espacio (flex 1.3→1.45), "Pozos operando" con un pelín más de margen arriba.

## 7. Pendientes / notas para la próxima sesión
- Backend corre con `--reload` (uvicorn), así que los cambios en `.py` se aplican solos — no hace falta reiniciar manualmente (esto contradice una nota de la sesión anterior, ya no aplica).
- Puertos 5173/8000 compartidos entre sesiones — verificar antes de asumir libres.
- Bug de herramienta: `computer.key` con nombres tipo "Down"/"Return" a veces NO dispara el evento correcto — usar "ArrowDown"/"ArrowUp" y para Enter mejor `dispatchEvent(new KeyboardEvent('keydown', {key:'Enter'}))` vía JS si el `computer.key` no responde.
- `DataTable` (ChartArea.jsx, tablas simples de Reservas/Precios/Inversiones/Licitaciones) sigue en CSV con `descargarCsvConHeader` — el usuario solo pidió el cambio a Excel para "temas absolutos de producción", no para estos.
- No se ha aplicado "Gráfica personalizada" a Campos/Asignaciones/Estado/Gcompo todavía (solo Operadores, Cuenca, Contratos) — no pedido aún, pero seguiría el mismo patrón (`SearchableSelect` + `exportChartPng`) si se pide.
