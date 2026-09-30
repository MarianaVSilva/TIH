# Chatbot TIH — en pausa (2026-07-02)

Estado: **implementado y funcional en local, pausado antes de pasar a producción.**
No se sigue trabajando en esto hasta nuevo aviso. Este documento resume qué existe,
qué se probó, y qué falta decidir/hacer para retomarlo.

## Qué ya existe (funcionando en local)

- Backend: `backend/app/routers/chat.py` + `backend/app/services/chat_service.py`
  - Endpoint `POST /api/v1/chat/stream`, streaming de texto plano.
  - Reenvía a Ollama (`http://localhost:11434/api/chat`) con `stream: true`.
  - Timeout de 120s con mensaje de error visible si Ollama tarda o falla (antes se quedaba colgado en silencio — ya arreglado).
  - Config en `backend/app/config.py`: `ollama_url`, `ollama_model` (actualmente `qwen2.5:7b`).
- Frontend: `frontend/src/components/Chat/`
  - `ChatButton.jsx`: botón flotante circular (verde salvia `#9CAF88`) con el ícono `public/golurk.png`.
  - `ChatPanel.jsx`: panel de chat, streaming vía `fetch` + `ReadableStream`.
  - `frontend/src/utils/chatContext.js`: arma el contexto de datos (`buildChatContext()`) leyendo `useExplorer.getState()` — tema, periodicidad, rango, y el JSON de `resultado` actual truncado a **2500 caracteres**.
  - Integrado en `App.jsx` (botón + panel montados fuera de `<main>`).

## Es "data-aware": qué significa

Cada pregunta del usuario se manda junto con un resumen del tema/tabla que tiene
en pantalla en ese momento (sección, tema, periodicidad, rango de años, y el JSON
de los datos visibles, truncado). El modelo responde interpretando esos datos, no
conocimiento general.

## Problema real encontrado (sin resolver): el modelo "inventa" sumas

Como el JSON que se manda está truncado y no trae totales precalculados, el modelo
tiene que sumar filas él mismo para responder preguntas como "¿qué operador perforó
más?" — y se equivoca (probado: mismo query, dos corridas dieron 84 y 248 pozos para
el mismo operador). **Esto no es un problema de qué modelo se use** — pasa igual con
7b y 3b. La solución real sería que el backend precalcule la respuesta (top N,
totales, etc.) directo desde los datos, en vez de mandarle JSON crudo al modelo para
que él calcule. Es básicamente un mini-RAG: el backend resuelve, el modelo solo redacta.

## Comparación de modelos (probado 2026-07-02, misma pregunta y contexto real)

| Modelo | Tiempo total (con carga) | Tiempo "en caliente" (sin carga) | Tokens generados |
|---|---|---|---|
| `qwen2.5:7b` (el actual) | 31.9s | ~17.1s | 62 |
| `qwen2.5:3b` | 19.1s | ~10.5s | 51 |

`qwen2.5:3b` es ~38% más rápido en caliente y carga en casi la mitad de tiempo.
Ambos respondieron con calidad comparable para preguntas de consulta directa
(no hay mucho margen de "razonamiento" que perder pasando de 7b a 3b para este caso de uso).

**Recomendación pendiente de aplicar:** cambiar `ollama_model` en
`backend/app/config.py` de `qwen2.5:7b` a `qwen2.5:3b` (ya está descargado
localmente). Otras opciones evaluadas pero no probadas a fondo: `qwen2.5:1.5b`
(más rápido aún), `llama3.2:3b`, `gemma2:2b`.

## Sobre "hacer un modelo propio"

- Entrenar desde cero: descartado, fuera de escala (necesita datasets masivos + semanas de GPU + equipo de ML).
- Fine-tuning (ej. LoRA sobre `qwen2.5:3b`): técnicamente posible pero requiere set curado de preguntas-respuesta + una GPU para el entrenamiento (una vez, no para producción). No se ha empezado a evaluar esto en serio.
- La opción más práctica y con mejor costo/beneficio: **mejorar el contexto** (ver sección de arriba) en vez de tocar el modelo. No entrenar nada, solo precalcular respuestas en el backend antes de mandárselas al LLM.

## Restricción del servidor de producción (contexto, ver también memoria de Claude: `project_tih_deploy_server.md`)

- Debian 13, 8 CPU, 16 GB RAM, 500 GB disco, IP `172.16.83.21`.
- **Sin GPU.** Convive con un "mapa grande" y una base PostgreSQL ya existentes — no es un servidor dedicado a TIH.
- Uso esperado: interno, entre 10 y 300 personas/día, uso no intensivo ni muy concurrente.
- Con ese perfil de uso (esporádico, no concurrente) el chatbot en CPU es viable, pero cada respuesta tardará segundos-a-minuto+ sin GPU, y Ollama procesa una petición a la vez por defecto (las demás quedan en cola).
- No se ha medido cuánta RAM/CPU consumen hoy el mapa y Postgres en ese servidor — falta ese dato antes de reservar recursos para Ollama ahí.

## Para retomar, en este orden sugerido

1. Cambiar el modelo a `qwen2.5:3b` en `config.py` y probar unos días en local para confirmar que la calidad sigue siendo aceptable.
2. Resolver lo de las sumas/totales: precalcular en el backend en vez de mandar JSON crudo al modelo.
3. Pedir un snapshot de RAM/CPU actual del servidor de producción (con mapa + Postgres corriendo) antes de decidir si Ollama vive ahí.
4. Decidir `OLLAMA_KEEP_ALIVE` para producción (cuánto tiempo se queda el modelo cargado en RAM entre usos).
5. Recién ahí armar el plan de despliegue (Docker/systemd + Nginx) para el chatbot en el servidor Debian.
