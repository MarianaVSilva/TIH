# Contexto de sesión — Pulido de "Actividad petrolera" (Pozos operando por campo)

Fecha: 2026-07-13

## Objetivo general
Pulir el dashboard TIH "sección por sección", empezando por la pill **Actividad petrolera**, que tiene 4 temas: Pozos operando por campo, Pozos Terminados, Pozos Perforados, Equipos de Perforación. Esta sesión se centró casi por completo en **Pozos operando por campo**.

## Trabajo realizado

### 1. Fix del tema "PozosCampos" (arrancaba roto)
- Error inicial: "Sección no reconocida: 'Actividad petrolera'" y sin datos.
- Causa: faltaba registrar el topic `PozosCampos` en dos `PERFORACION_TOPICS` distintos (`frontend/src/hooks/useChartData.js` y `frontend/src/components/Header/TopBar.jsx`), y no existía la función de servicio en el backend.
- Se creó `_get_pozos_campos()` en `backend/app/services/perforacion_service.py`, consultando la tabla `PRODUCCION_CAMPOS_POZOS` (cuenca, ubicación, campo_portal, pozos_aceite, pozos_gas).

### 2. Corrección de semántica contra el proyecto original SIH_LOGIN
Se comparó contra `C:\Users\Mariana Vasquez\Desktop\MARIANA PROYECTOS\SIH_LOGIN` (fuente de verdad) y se corrigieron:
- Aceite y gas **no se suman** en un solo total: son dos categorías "Tipo" separadas (`Pozos de petróleo y gas asociado` / `Pozos de gas no asociado`), replicando el SIH original.
- Agregación anual: **promedio** de los meses (foto de pozos activos), no suma. Mensual sí usa `sum()` (dedupe).
- KPI "Total" = pozos del período más reciente (no la suma de todos los años).
- KPI "Ambiente principal" se calcula con un `groupby("ubicacion")` real, no reutilizando el mismo valor que "Campo principal".

### 3. Filtro "Filtros" que desaparecía
- Bug: al seleccionar "Pozos operando por campo" el botón/pill de Filtros desaparecía.
- Causa: un **segundo** `PERFORACION_TOPICS` (en `TopBar.jsx`, distinto al de `useChartData.js`) tampoco tenía registrado `PozosCampos`, y las opciones de filtro (`perfOpciones`) solo se cargaban una vez (no por topic).
- Fix: añadir el topic en ambos sitios + refetch de `perfOpciones` en cada cambio de `tema.json_arg`.

### 4. Rendimiento del sitio ("muy lento al cargar")
- Se detectó que las tablas base son **vistas de SQL Server**, algunas con agregación en vivo sobre tablas crudas nivel-pozo/día en una base enlazada (`cmde_valid`). No se pueden indexar directamente (`Cannot create index on view... not schema bound`).
- Solución aplicada: capa de **caché en memoria** (`backend/app/services/cache_utils.py`, decorador `@cached(ttl_seconds=1200)`, 20 min TTL, keyed por módulo+función+args) aplicada a ~15 funciones de consulta pesadas en todos los servicios (`produccion_service`, `estado_service`, `contratos_service`, `inversiones_service`, `reservas_service`, `temas_service`, `perforacion_service`).
- Mejora medida: PozosCampos 3.4s→0.27s, Estado 4.8s→0.21s, Panorama general 8s→0.27s (en cache hit).
- Optimización adicional: patrón O(n²) de filtrado pandas por campo (~22,000 operaciones) reemplazado por `groupby(["campo","periodo"])[col].sum().unstack(fill_value=0)` (pivot vectorizado): PozosCampos pasó de ~6.1s a ~3.7s solo con esto, antes del caché.

### 5. Migración a PostgreSQL — DEFERIDA explícitamente
- Se discutió migrar la base de datos (views → tablas reales indexadas) a PostgreSQL. El usuario confirmó que ninguna otra app depende ya de esta base, así que sería seguro.
- Decisión explícita del usuario: **no hacerlo ahora**. "Planeemos bien, pero por ahora sigamos con esto, ya que esté el portal, reestructuramos la base."
- **No iniciar esta migración sin instrucción explícita nueva.**

### 6. Columna "Suma" en DynamicTable
- Al seleccionar 2+ años en vista anual, aparece una columna "Suma" a la derecha con el acumulado del rango (`frontend/src/components/Charts/DynamicTable.jsx`).
- Se le dio un tono distinto (índigo `#eef2ff` / `#818cf8`, texto más tenue) del resto de columnas.
- Se puede ocultar/mostrar desde el menú "Columnas" del toolbar (checkbox "Suma").

### 7. División Tipo (gas no asociado / petróleo y gas asociado) como filtro real
- Inicialmente se forzó (`forceDivisions`) que la tabla siempre mostrara el desglose por Tipo — el usuario pidió que en cambio fuera **un filtro más** (como "Categoría" en los demás temas): sin selección, todo junto; al marcar, se divide.
- Se agregó la sección **"TIPO"** en el drawer de filtros (`TopBar.jsx`), con las opciones "Pozos de petróleo y gas asociado" y "Pozos de gas no asociado".
- Backend: `get_perforacion_filtros` expone `categorias` con los dos tipos; `_get_pozos_campos` filtra `_POZOS_CAMPOS_TIPOS` según lo seleccionado.
- Se eliminó `forceDivisions` de `ChartArea.jsx` (ya no se fuerza).
- Fix adicional: si un grupo (Ambiente/Cuenca/Tipo) no tiene datos, ya **no aparece** su fila vacía en la tabla (`DynamicTable.jsx`, función `walk()`, chequeo `hasData(bucketTotal)`).

### 8. Colores por nivel de jerarquía en DynamicTable
- Antes todos los niveles de agrupación ("planheader": Ambiente, Cuenca, Tipo) se veían con el mismo verde — confuso.
- Se agregó paleta `PLANHEADER_TONES` (teal, azul, ámbar, magenta) indexada por `_depth`, aplicada al fondo, borde izquierdo y texto de cada nivel.

### 9. Estilo del gráfico de barras ("Ver como gráficos") — alineado con Reservas
- En `ChartArea.jsx` (`SingleChart`), las barras ahora usan: esquinas superiores redondeadas, paleta gris/tipografía de `HomeDashboard.jsx` (`#767b87`, `#1f2430`, `#e7e5e0`), sin `splitLine` horizontal, ancho de barra 32px.
- Con pocas categorías (≤8, ej. 2 años seleccionados), el gráfico ya no se estira a todo el ancho — se calcula un ancho máximo (`categorías × 130px`, mínimo 220px) y se centra, para que las barras no se vean dispersas. Se agregó una `key` dinámica al componente para forzar remount limpio al cambiar de tipo de gráfico o de "pocas" a "muchas" categorías.
- **Nota**: esta última parte no se pudo verificar visualmente con captura de pantalla en la sesión (el tooling de preview tuvo timeouts recurrentes en `preview_screenshot` durante toda la sesión, aparentemente un problema de infraestructura, no del código). Se verificó por DOM/estilos computados que el ancho se calcula correctamente. **Pendiente: confirmar visualmente en el navegador real.**

## Pendientes / próximos pasos
1. **Confirmar visualmente** el fix de "barras más juntas con pocos datos" en `http://localhost:5173` (Actividad petrolera → Pozos operando por campo → 2024-2025 → Ver como gráficos → Barras).
2. Revisar los otros 3 temas de Actividad petrolera contra SIH_LOGIN: **Pozos Terminados**, **Pozos Perforados**, **Equipos de Perforación** (aún no iniciado).
3. Migración a PostgreSQL: planearla cuando el usuario lo pida explícitamente, no antes.

## Cómo levantar el entorno local
```cmd
cd backend
py -3 -m uvicorn app.main:app --port 8000
```
```cmd
cd frontend
npm run dev
```
Frontend: http://localhost:5173 — Backend: http://localhost:8000
El backend no tiene `--reload`: hay que reiniciarlo manualmente tras cada cambio en Python. El frontend sí tiene hot-reload (Vite).

## Archivos clave tocados en esta sesión
- `backend/app/services/perforacion_service.py`
- `backend/app/routers/perforacion.py`
- `backend/app/services/cache_utils.py` (nuevo)
- `backend/app/services/{produccion,estado,contratos,inversiones,reservas,temas}_service.py` (solo se agregó `@cached()`)
- `frontend/src/hooks/useChartData.js`
- `frontend/src/components/Header/TopBar.jsx`
- `frontend/src/api/client.js`
- `frontend/src/components/Charts/ChartArea.jsx`
- `frontend/src/components/Charts/DynamicTable.jsx`
