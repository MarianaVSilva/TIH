# Sesión 2026-08-28

## 1. Reemplazo del export PDF nativo por ExportPDFTIH
- El usuario trajo 3 archivos propios (`ExportPDFTIH.jsx`, `.css`, guía) hechos con `html2canvas` + `jsPDF`, pidiendo reemplazar el export nativo (jsPDF vectorial) del Panorama general — decisión explícita del usuario ("Sí, reemplázalo con esto"), pese a que html2canvas se había descartado antes en el proyecto por calidad de impresión.
- Adaptador `buildExportPDFData()` en `HomeDashboard.jsx`: mapea la respuesta de `/resumen` (anidada) a la forma plana que espera el componente.
- **Bugs reales encontrados en el código del usuario** (no reportados por él, silenciosos):
  - Página de tamaño `'a4'` fijo recortaba todo lo que pasara de una hoja (Operador/Reservas/Pozos desaparecían). Corregido a `format:[ancho,alto]` dimensionado al contenido real.
  - `<style>` inyectado sin escopar (`*`, `body`) se aplicaba al DOM real del sitio (el `<style>` cuelga del documento, no del nodo) — el `body.text-white` del sitio pisaba el color del texto inyectado → texto invisible. Escopado bajo `.pdf-export-root`.
- Rediseño completo del layout a pedido del usuario, iterando sobre una imagen de referencia (barras verde/amarillo/naranja con año, look "reporte"):
  - Vertical/portrait, logo `SENER_LOGO2.png` + título, colores/tipografía copiados 1:1 de `HomeDashboard.jsx`.
  - **Bug de html2canvas descubierto por depuración pixel a pixel** (captura de Blob interceptando `URL.createObjectURL`/`<a>.click`, inspección con pymupdf): con 1 sola categoría en un chart tipo "line", `symbol:"none"` deja la gráfica completamente en blanco (sin línea que dibujar, sin punto visible) aunque el dato exista — corregido en `buildChartOption` (`ChartArea.jsx`): `symbol: categories.length <= 1 ? "circle" : "none"`. Este fix es genérico, afecta cualquier chart de línea del sitio, no solo el PDF.
  - Pills/leyendas: html2canvas ignora `align-items`/`justify-content` en flex y desplaza el texto ~5.8px de su centro — resuelto dibujando las pills como SVG en vez de HTML+CSS.
- Redondeo de valores: `Math.round()` a entero perdía precisión (1.48 se veía como "2"); corregido a 2 decimales, igual que el backend.

## 2. Gráficas de Reservas — rediseño completo
- Petición: mostrar años en el eje (antes solo el último año). Iterado varias veces con el usuario hasta llegar a: barras **agrupadas** (no apiladas) 1P/2P/3P con su valor real, sin cálculo de incrementos.
- Se quitaron por pedido explícito: "Gráfica personalizada por cuenca" y el toggle "Instantánea" (círculos). La vista por defecto de "Ver como gráficos" pasó de "Top 8 campos" a una **agregación nacional** 1P/2P/3P por año.
- `buildReservasCampoGroupedOption()` en `ChartArea.jsx`: 3 series de barra sin `stack`, colores fijos verde/amarillo/naranja.

## 3. Botón "Columnas" en DynamicTable
- Se ocultaba mal: en vista mensual sin columna "Suma" disponible, el menú se abría vacío. Corregido en `DynamicTable.jsx` con `(!isMonthly || sumaDisponible) && (...)`.

## 4. Fichas de entidad interconectadas (feature grande)
Petición del usuario: "que todo esté interconectado" — clic en un campo/pozo/asignación/operador abre su ficha con datos relacionados navegables, sin perder contexto.

### Infraestructura nueva — `frontend/src/components/Fichas/`
- `FichaContext.jsx`: pila de fichas (`stack`) en Context, `useAbrirFicha()` para abrir desde cualquier componente sin prop-drilling.
- `FichaShell.jsx`: armazón común (overlay, migas de pan, botón "← Atrás").
- `BloqueProduccion.jsx`: tabla/gráfico de producción + bloque de reservas 1P/2P/3P, extraídos de los paneles duplicados.
- `FichaCampo` / `FichaAsignacion` / `FichaPozo` / `FichaOperador` (nuevo) + `FichaModal` (despachador, montado una vez en `App.jsx` dentro de `FichaProvider`).
- Se borraron `AsignacionDetallePanel.jsx` y `CampoDetallePanel.jsx` (reemplazados).

### Endpoint nuevo
- `GET /produccion/operadores/detalle` (`get_operador_detalle` en `produccion_service.py`): asignaciones, campos y serie de producción agregada de un operador.

### Bugs de datos encontrados y corregidos (todos verificados contra la BD real, no solo en código)
1. **`entitlements.fields` (Play/Profundidad/Año descubrimiento) siempre vacío**: el código solo consultaba esa tabla `if not _PG`, y localmente `DB_ENGINE=postgres` — nunca se ejecutaba. Verificado que esos atributos **no están replicados a Postgres** (`core.dim_campo` solo tiene región/lat/long). Solución: `get_engine_catalogo_sqlserver()` en `database.py` abre una conexión aparte a SQL Server solo para este catálogo, aunque el motor principal sea Postgres (las credenciales ya están en `.env`). Best-effort: si falla, degrada a `[]`.
2. **Comparación de nombres entre tablas**: el mismo campo/operador se escribe distinto según la tabla de origen —
   - Operador: `PEMEX EXPLORACIÓN Y PRODUCCIÓN` (PRODUCCION_CAMPOS) vs `Pemex Exploración y Producción` (BD_POZOS).
   - Campo: `AYATSIL`/`TUPILCOPROFUNDO` (CAMPO_PORTAL) vs `Ayatsil`/`Tupilco Profundo` (RESERVAS_CAMPOS, entitlements.fields).
   Solución: `_norm_texto_sql()` (produccion_service.py) y `_norm_campo_sql()` (reservas_service.py) — quitan espacios y normalizan acentos/mayúsculas (`COLLATE Latin1_General_CI_AI` en SQL Server, `TRANSLATE` en Postgres) en ambos lados de la comparación.
3. **Ficha de asignación excluía contratos**: `get_asignacion_detalle` filtraba `TIPO = 'ASIGNACION'`, dejando fuera los contratos (`CNH-…`). Verificado que ningún `ASIG_CONT` tiene más de un `TIPO` — se quitó el filtro, ahora sirve para ambos.
4. **Pozos de un campo mezclados entre campos vecinos** (el bug más serio, reportado por el usuario: "dice 19 pero da clic y dice 0", luego "checa bien, esa no es la cifra correcta"):
   - `get_pozos_campo_detalle` resolvía campo→**contrato**→pozos. Un contrato puede cubrir varios campos: `CNH-R01-L02-A1/2015` (Eni Área 1) cubre Amoca+Miztón+Tecoalli. Al abrir AMOCA, la lista incluía también pozos de los otros dos.
   - Además el `LIKE 'código-%'` daba 0 para contratos (su ASIG_CONT en PRODUCCION_POZOS es el código exacto, sin sufijo) — ahí sí salía "no se encontraron pozos".
   - Solución: filtrar por el **campo real del pozo** vía `bd_pozos.FIELD` (en Postgres: `staging.stg_bd_pozos.field`, no expuesta aún en `api.*` — pendiente de subir a una vista cuando se retome la migración) en vez de por asignación. Verificado contra la cifra oficial de `PRODUCCION_CAMPOS_POZOS`: Culebra 241=241, Nejo 171=171, Miztón 6=6, Tamaulipas Constituciones 169=169. Con fallback al método anterior si el cruce por FIELD no devuelve nada.
   - **AMOCA específicamente sigue sin cuadrar** (14 en PRODUCCION_POZOS vs 20 en el agregado oficial) — verificado que es una discrepancia real entre tablas de origen, no arreglable desde el código. Se corrigió también la nota en pantalla, que antes daba una explicación falsa ("promedio anual vs distintos del año" — comprobado falso, difería mes a mes también).

### Verificación
Todo el flujo (Campo → Asignación → Operador → Pozo, con migas de pan y "Atrás") se probó en el navegador con datos reales sobre el dev server, no solo build limpio.

## Archivos tocados esta sesión
- `frontend/src/components/ExportPDFTIH/ExportPDFTIH.jsx` (+ `.css`, nuevo)
- `frontend/src/components/Charts/HomeDashboard.jsx`
- `frontend/src/components/Charts/ChartArea.jsx`
- `frontend/src/components/Charts/DynamicTable.jsx`
- `frontend/src/components/Charts/PozosCampoDetallePanel.jsx`
- `frontend/src/components/Charts/AsignacionDetallePanel.jsx` (borrado)
- `frontend/src/components/Charts/CampoDetallePanel.jsx` (borrado)
- `frontend/src/components/Fichas/*` (nuevo: FichaContext, FichaShell, FichaModal, FichaCampo, FichaAsignacion, FichaPozo, FichaOperador, BloqueProduccion)
- `frontend/src/utils/nombreCampo.js` (nuevo)
- `frontend/src/App.jsx`
- `frontend/src/api/client.js`
- `backend/app/database.py`
- `backend/app/services/produccion_service.py`
- `backend/app/services/reservas_service.py`
- `backend/app/services/perforacion_service.py`
- `backend/app/routers/produccion.py`

## Git / despliegue
- Se hizo un commit y push a `origin/master` (repo GitLab self-hosted, `172.16.196.12/mvazquez/tih.git`) a mitad de sesión, cubriendo el trabajo hasta ese punto (export PDF + reservas + Columnas). Confirmado con el usuario que se desplegó vía pipeline de GitLab CI en el servidor (`172.16.83.21`, `/opt/tih`, systemd `tih_backend` + Apache).
- **Todo lo de la sección 4 (Fichas) NO está commiteado ni pusheado** — pendiente instrucción explícita del usuario.

## Pendiente / posibles siguientes pasos
- Cuenca y Entidad Federativa siguen sin ficha propia (el usuario pidió "campos, pozos, asignaciones, contratos, reservas, empresas" — cubierto todo salvo estas dos, a definir qué mostrarían).
- Subir `bd_pozos.FIELD` a una vista de `api.*` en Postgres (hoy se lee de `staging.stg_bd_pozos`, que no es la capa pensada para consultarse desde el backend).
- Revisar con el dueño de la BD por qué AMOCA difiere entre `PRODUCCION_POZOS` y `PRODUCCION_CAMPOS_POZOS` (20 vs 14) — no es un bug de consulta.
- Confirmar si conviene reproducir el mismo fix de "campo real por bd_pozos.FIELD" en `get_asignacion_detalle`/`FichaAsignacion` (hoy sigue resolviendo pozos de una asignación por LIKE de ASIG_CONT, que para contratos multi-campo tendría el mismo problema).
