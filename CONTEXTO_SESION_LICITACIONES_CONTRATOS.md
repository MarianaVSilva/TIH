# Licitaciones y Contratos, Inversiones, responsive y fixes varios — 2026-08-11/12

## 1. Bug de responsividad (App.jsx, HomeDashboard.jsx)
- `<main>` usaba `overflow-clip` en pantallas ≥1024px: recortaba contenido sin dar scroll. Cambiado a `overflow-y-auto overflow-x-hidden` siempre.
- `HomeDashboard` forzaba altura fija ("quepa sin scroll") con `min-h-0`/`flex-basis` — en ventanas cortas comprimía las tarjetas de Top Campos/Reservas por debajo de su contenido y el texto se superponía. Se quitó el forzado, ahora usan alto natural.
- `CampoRow` (barriles de Top Campos/Reservas) tenía anchos fijos que no cabían en tarjetas a media pantalla — reducidos.

## 2. Precios de petróleo y gas
- Fix real: `get_precios()` no agregaba (Anual/Mensual no hacían nada); ahora agrupa con promedio. Ceros tratados como null (antes ensuciaban promedios y se graficaban como $0 falso).
- Nuevo modo "Diario" con selector de calendario (`DateRangeSelector` en TopBar.jsx).
- KPIs de extremos (más bajo/alto) para Brent/MME/Henry Hub, funcionando también en Diario.
- Layout: gráfica única con switch Petróleo/Gas en vez de dos lado a lado.

## 3. Bug de enrutamiento (useChartData.js)
`PRECIOS_SECCIONES` incluía toda la sección "Indicadores Economicos" (que también contiene los temas de Inversiones) — todo lo de Inversiones pegaba por error a `/precios/`. Corregido a enrutar por `json_arg` específico.

## 4. Inversiones aprobadas por cuenca / por contrato (`inversiones_service.py`)
- Reescritas para devolver el formato `hierarchical` (groups→subgroups→rows) que usa `DynamicTable.jsx` — mismo componente/estilo que el resto del sitio, no una tabla propia.
- **Por cuenca**: Total general (+ desglose Ambiente) → Cuenca → Entidad Federativa → Ambiente.
- **Por contrato**: Total general → Pemex Asociaciones/Migraciones/Ronda 1-3 → Licitación → Contrato.
- Gráfica: línea/barra/pastel (según pedido del usuario, terminó en barra/pastel, sin línea), nota "Montos en USD".
- Botón **Filtros** vive en `TopBar.jsx` (`InvDrawer`), igual que Perforación/Producción — no arriba del contenido.
- "Gráfica personalizada" (solo por contrato): elegir un contrato, con etiqueta de a qué Ronda/Licitación pertenece (`ContratoCustomChart` con prop `badgeFor`).

## 5. Bug de búsqueda en DynamicTable.jsx (afecta TODO el sitio)
La búsqueda solo miraba las filas hoja ("operator"), nunca los niveles intermedios ("subtotal": Entidad Federativa, Licitación, etc.) — buscar "Campeche" no encontraba nada aunque existiera. Corregido en dos puntos (`contratoCoincide`, `pushOperatorRows`) para que también matchee subtotales y abra automáticamente la rama donde está el resultado. Mismo fix aplicado al branch sin subtotal (país→empresa) para Contratos adjudicados.

## 6. Licitaciones y Contratos — 3 temas nuevos, mismo patrón que arriba
Todos: solo Anual (ya viene de `CUBOS.PERIODICIDAD`), arrancan en "Ver como tablas", sin filtro de Periodo (dato de corte vigente, no serie temporal — se muestra "Corte vigente" en vez del selector de años), columnas en orden alfabético/fijo (`preserveColumnOrder` en DynamicTable, antes invertía asumiendo años), subcategorías ordenadas alfabéticamente, grupos con subtotal arrancan expandidos (antes colapsados por default, parecía que faltaban subcategorías).

- **Pozos comprometidos** (`get_pozos_comprometidos`): tabla `rdmx.T_21_PozosComprometidos` + join `INVERSIONES_APROBADAS` (MODALIDAD/UBICACION). Total → Licencia/Producción compartida → Ronda-Licitación/Asociaciones Pemex → Contrato. Valor = pozos comprometidos, columnas = Ambiente.
- **Ofertas de pago en efectivo** (`get_ofertas_efectivo`): tabla `licitaciones_bloques_ofertas`, columna `bono`, filtrado a ganadoras (`id_licitante = id_licitante_adj`). Mismo patrón, valor = USD.
- **Inversión comprometida** (`get_inversion_comprometida`): misma tabla, columna `inv_usd` (¡OJO: viene repetida por cada socio del consorcio, no por bono — se deduplica con `groupby().first()`, no se suma!). Valores en millones de USD. "PMT" = Programa Mínimo de Trabajo (nota explicativa agregada en UI).
- **Contratos adjudicados** (`get_contratos_adjudicados`): misma tabla, sin filtrar por bono/inv — País de origen → Empresa, columnas = bloque/licitación (Trion, Ogarrio, C. Mora, R0X-L0Y), valor = conteo de contratos.
- **Superficie adjudicada** (AreaLic): oculto del listado (`temas_service.py`), no se desarrolló.

## 5. Otros temas ocultos
`InvTipo`, `InvEst` (Inversiones), `AreaLic` (Superficie adjudicada) — excluidos vía WHERE en `temas_service.py`, no en la BD.

## Gotchas de sesión
- El backend con `--reload` a veces NO recarga con ediciones rápidas/múltiples archivos seguidos — si un endpoint nuevo da 404 en vivo pero el código está bien, matar el proceso python y reiniciar a mano en vez de confiar en el watcher.
- El caché en memoria (`cache_utils.py`, TTL 1200s) sobrevive dentro del mismo proceso — un `--reload` que sí recarga limpia el caché (proceso nuevo), pero si el reload no ocurrió, el caché sirve resultados viejos aunque el código ya esté corregido.
- Nada de esto está desplegado a producción (172.16.83.21:8091) — todo el trabajo de esta sesión quedó sin commitear/pushear, confirmar con el usuario antes de tocar el servidor.
