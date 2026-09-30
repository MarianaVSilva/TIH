# Sesión TIH — 2026-07-09 — Panorama general (rediseño de cards)

Resumen para retomar en otra conversación (nueva sesión de Claude Code abierta
**dentro de esta carpeta**, `C:\Users\Mariana Vasquez\Desktop\MARIANA PROYECTOS\TIH`,
para que las herramientas de preview/navegador sí funcionen).

## Qué es esto

El "Panorama general" es el home dashboard que se muestra en
`frontend/src/components/Charts/HomeDashboard.jsx` cuando no hay tema
seleccionado (se renderiza desde `ChartArea.jsx` cuando `!tema`).

Está en rediseño visual iterativo tipo "cards": tarjetas blancas con
borde/sombra sutil, sin tarjeta contenedora exterior grande, todo debe caber
en pantalla sin activar scroll (aunque se dejó `overflowY: auto` como red de
seguridad).

## Consideraciones de todo el proyecto (no solo esta pantalla)

- Uso **interno**, con flujo esperado de **500 usuarios concurrentes**.
- Sitio **seguro**: CSP vía middleware en `backend/app/main.py`, y queries
  protegidas contra inyección SQL (allowlist en `contratos_service.py`,
  `sqlalchemy.text()` parametrizado en `reservas_service.py`).
- Pendiente de infraestructura, pospuesto explícitamente por la usuaria hasta
  el despliegue: pool de conexiones SQLAlchemy (`pool_size`/`max_overflow`) y
  `--workers` de uvicorn.

## Estructura actual del dashboard (de arriba hacia abajo)

Todo vive en `HomeDashboard.jsx`. Componentes reutilizables: `Card`,
`CardTitle` (con chip de categoría opcional), `Chip`, `FuelToggle`, `BigStat`,
`IndicadorEconomico`, `Barrel`/`BarrelPartial`, `CampoRow`/`CamposColumn`,
`ContratoBar`.

1. **"● Panorama general"** + fecha (mes/año del dato) — fila superior, sin
   título/subtítulo grande.
2. **Fila 1** (lado a lado, grid 2 columnas): `CifrasNacionales` (chip
   "Producción" verde, "Mensual por Asignación": Hidrocarburos líquidos Mbd +
   Gas natural MMpcd, con % de cambio vs. promedio del año anterior) e
   `IndicadoresEconomicos` (chip "Mercado" naranja, Brent y Mezcla Mexicana en
   mitades de color salmón/verde, con fecha y nota al pie).
3. **Fila 2** (lado a lado): `TopCampos` (chip "Campos" verde, "Top 8
   Productores", switch Líquidos/Gas, 2 columnas de 4 filas con **barrilitos**
   — íconos SVG de barril con relleno parcial, **NO reemplazar por barras
   planas**, confirmado explícitamente dos veces por la usuaria) y
   `ProduccionPorOperador` (chip "Operador" azul, donut PEMEX E&P vs Otros,
   switch Líquidos/Gas, desglose por contrato).
4. **Fila 3** (ancho completo): `PozosOperando`, fondo salmón sólido, número
   grande + barra segmentada 2 colores (petróleo+gas asociado vs. gas no
   asociado+condensado). Fuente: `PRODUCCION_CAMPOS_POZOS`
   (`POZOS_ACEITE`/`POZOS_GAS`), confirmada por la usuaria.

Las proporciones de alto de fila están puestas a mano en el contenedor flex-col
raíz: fila 1 sin `flex-grow` (se ajusta a contenido), fila 2 `flex: 1.3`, fila
3 `flex: 0.9`.

## Diseño de referencia

Se compartieron **dos** handoffs de diseño en zip a lo largo de la sesión:

1. Primero un mockup oscuro/neón con chips de categoría (pastillas de color
   antes de cada título) — ya aplicado.
2. Después `design_handoff_indicadores_financieros` (carpeta
   `design_reference.html` + `README.md`, extraídos en
   `C:\Users\Mariana Vasquez\Downloads\indicadores_extracted\`) — handoff de
   alta fidelidad con tokens exactos en OKLCH, tipografía Space Grotesk /
   Manrope / IBM Plex Mono, glow sutil en cifras hero, proporciones de fila
   por `flex-grow` (0.5 / 1 / 0.7), fondo tintado naranja solo en "Pozos
   operando". Ese handoff mostraba **barras planas** en vez de barrilitos en
   Top Campos — se le preguntó explícitamente a la usuaria vía
   `AskUserQuestion` y respondió **"Mantén los barrilitos"**. Los barrilitos
   siguen y deben seguir intactos.

No se importaron las fuentes Space Grotesk/Manrope/IBM Plex Mono (se mantuvo
Patria, ya oficial de TIH, para los números — precedente de sesiones
anteriores de no romper la identidad visual del sitio).

## Último trabajo (en curso, sin confirmar visualmente)

Fila 1 (`CifrasNacionales` + `IndicadoresEconomicos`) quedaba **dispareja en
alto** en cada iteración. Se probaron varios ajustes de padding sin éxito
según capturas de la usuaria. La causa real encontrada al final: el grid
contenedor de la fila 1 tenía `items-start`, forzando a cada card a su propio
alto de contenido en vez de igualarse. Se quitó `items-start` (vuelve al
`stretch` por defecto de CSS grid) y se hizo que el contenido interno de
ambas cards (el bloque de cifras y el bloque de indicadores) use
`flex: 1` + centrado vertical, para que al estirarse a la misma altura el
contenido quede centrado en vez de pegado arriba con hueco abajo.

**Esto NO se ha confirmado visualmente todavía** — es el punto exacto donde
quedó la sesión anterior. Al retomar, lo primero es levantar el frontend
(`npm run dev` en `frontend/`, puerto 5173) y backend (`uvicorn app.main:app
--port 8000` sin `--reload`, desde `backend/`, matando el proceso previo en
el puerto 8000 tras cualquier cambio de Python), abrir el navegador y
verificar si "Producción mensual por Asignación" e "Indicadores Económicos"
ya quedaron del mismo alto.

## Nota sobre por qué se generó este archivo

Esta sesión de Claude Code corría con raíz de proyecto en
`C:\dgime\entitlements` (repo no relacionado), así que las herramientas de
preview/navegador no podían apuntar a TIH (validado: `preview_start` falla
con "cwd must be a relative path within the project root"). Para poder
verificar visualmente los cambios, la usuaria va a abrir una nueva sesión de
Claude Code **con esta carpeta (`TIH`) como raíz del proyecto**. Este archivo
es el contexto para retomar ahí mismo, sin perder el hilo de lo trabajado.
