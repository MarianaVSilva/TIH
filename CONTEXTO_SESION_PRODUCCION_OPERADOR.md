# Producción por operador — rediseño completo (2026-07-28)

**Sesión anterior:** `CONTEXTO_SESION_KPIS_EXPORT_GIT.md`

## 1. Contexto de datos (hallazgo clave)
`PRODUCCION_OPERADOR_IP` (backend/app/services/produccion_service.py) SÍ tiene las 8 columnas de producto, igual que `PRODUCCION_CAMPOS` — el código viejo solo nunca las consultaba. Confirmado vía query directa a la BD real (`app.database.engine`), no confiar en `DATABASE_SCHEMA.md` (desactualizado, dice que solo tiene petróleo/gas/agua).
Columnas reales: `FECHA, ASIG_CONT, EMPRESA, FACTOR_O, FACTOR_IP, FACTOR_MES, DIAS_PRODUCCION, PETROLEO_MBD, GAS_MMPCD, GAS_ASOC_MMPCD, GAS_NASOC_MMPCD, CONDENSADO_MBD, N2_MMPCD, AGUA_MBD`.
`ASIG_CONT` es el contrato — compartido con `PRODUCCION_CAMPOS`/`PRODUCCION_POZOS`.

## 2. Diseño final (tras varias iteraciones descartadas)
**Vista "Nacional" (sin filtro, o con Pemex+Privadas ambos)**: Producto (subtotal, negrita) → Grupo (Pemex Exploración y Producción / Privadas). Productos con producción 0 en el rango se omiten.

**Vista "Empresa" (filtro con exactamente UN grupo, Pemex o Privadas)**: lista de empresas de ese grupo, ordenadas por PCE (líquidos + gas/5) descendente, colapsadas por defecto. Al expandir: Producto (subtotal) → Contrato (hoja). Contratos que empiezan con `A-`/`AE`/`AR` se agrupan en una fila "Asignaciones" (mismo criterio que `get_operadores()` en `contratos_service.py`); el resto se muestra individual (p. ej. `CNH-M1-EK-BALAM/2017`).

**Filtro**: drawer "Filtros" solo tiene sección "Operador" con 2 chips fijos (PEMEX / Privadas), no lista de checkboxes. El filtro de "Producto" que se agregó a medio camino SE QUITÓ — el usuario prefirió que los productos sean las SERIES (chips arriba de la tabla), no un filtro aparte.

**groupBy** (frontend, `TopBar.jsx`): para tema "Operadores", `null` si 0 o 2 grupos seleccionados (vista Nacional), `"cuenca"` si exactamente 1 (vista Empresa). Igual patrón condicional que Campos/API, no forzado fijo (se intentó forzar siempre a "cuenca" y siempre a `null` en iteraciones intermedias — ambas fallaron para alguno de los dos casos).

## 3. Cambios en `DynamicTable.jsx` (compartido, cuidado con regresiones en Campos/API)
- Anchos de columna mensual: 52px→68px (mes), 56px→76px (Suma) — los números de producción (ej. "20,659.79") desbordaban la celda con `overflow:visible` y se veían encimados. Esto es un fix GLOBAL, afecta a todas las tablas mensuales.
- `groupBy === "cuenca"`: ahora detecta si `subgroups[0].rows` trae filas `type==="subtotal"` (nuestro caso Empresa→Producto→Contrato) y si es así usa `pushOperatorRows` (respeta jerarquía) en vez de `mergeSubgroups` (aplanaría y mezclaría Mbd+MMpcd en un solo total). Campos/API no tienen `subtotal` rows → sin cambio de comportamiento para ellos.
- `initOpenGroups` para `groupBy==="cuenca"`: si el grupo tiene subtotal-shape, arranca COLAPSADO (antes todo expandido, apto para pocas cuencas pero no para ~20 empresas).
- `expandAll()`: no contemplaba `groupBy==="cuenca"` (solo hierLevels>0 / resto) → no abría nada en este modo. Fix: rama nueva que agrega `cuenca|${g.cuenca}` de cada grupo real.
- Botón "Contraer/Expandir todo": vivía solo dentro de la fila `_type==="banner"` (nodo "Nacional"). La vista Empresa no tiene ese nodo → sin botón. Fix: se agregó también al `Toolbar` (prop `toggleAllGroups`/`hasOpenGroups`), condicionado a `groupBy==="cuenca" && !rows.some(r=>r._type==="banner")` para no duplicar en Campos/API.
- Nueva prop `rowHeaderLabel`: encabezado de la columna de nombres (vacío por defecto). Para Operadores se pone "Privados" (estilo igual al banner "Nacional": gradiente `linear-gradient(90deg,#10312B,#1a4a3a)`, texto blanco bold uppercase) — pero SOLO cuando el filtro activo es exactamente `["Privadas"]`, no en Nacional ni con Pemex.

## 4. Backend (`produccion_service.py`)
Funciones nuevas: `_filas_nacional_por_producto` (Producto→Grupo), `_filas_empresa_por_producto` + `_hierarchia_empresa_operador` (Empresa→Producto→Contrato), `_remap_contrato`. `PRODUCTOS_EMPRESA` ahora son las mismas 8 tuplas que `PRODUCTOS` (Cuenca). `get_produccion_empresas()` decide la forma de `groups` según `len(grupos_sel)`. `series` = un item por producto con datos nacionales (o del grupo filtrado), reemplazó al viejo diseño de series-por-grupo. KPI "Producción total" siempre en Mbd (ya no hay selector de producto/unidad variable).

## 5. Pendiente / notas
- Contador "N operadores" en el toolbar cuenta filas hoja visibles (contratos), no empresas — con todo colapsado muestra "0 operadores". No se corrigió (no pedido explícitamente).
- Servidores backend/frontend corren sin `--reload`/HMR-only para backend — **reiniciar manualmente el backend tras cada cambio en `backend/`** (ya pasó varias veces en esta sesión que se probó código viejo por no reiniciar).
- Puertos 5173/8000 se comparten con otras sesiones de chat — verificar con `preview_list`/`netstat` antes de asumir que están libres.
- Bug de herramienta: `computer.left_click` con `ref` a veces calcula coordenadas fuera del viewport reportado (x > 1280) y el click no pega en nada — usar `javascript_tool` con `element.click()` como fallback confiable para elementos dentro de diálogos/drawers.
