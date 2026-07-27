import json
import httpx
from app.config import settings

SYSTEM_PROMPT = (
    "Eres el asistente del Tablero de Información de Hidrocarburos (TIH) de la "
    "Secretaría de Energía de México. Respondes en español, de forma breve y precisa, "
    "interpretando los datos que el usuario tiene actualmente en pantalla en el tablero. "
    "Si el contexto de datos no alcanza para responder algo, dilo con honestidad en vez de inventar cifras."
)


async def stream_chat(message: str, history: list[dict], context: str | None):
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if context:
        messages.append({
            "role": "system",
            "content": f"Datos actualmente visibles en el tablero:\n{context}",
        })
    messages.extend(history)
    messages.append({"role": "user", "content": message})

    payload = {
        "model": settings.ollama_model,
        "messages": messages,
        "stream": True,
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
            async with client.stream("POST", f"{settings.ollama_url}/api/chat", json=payload) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    chunk = json.loads(line)
                    content = chunk.get("message", {}).get("content", "")
                    if content:
                        yield content
                    if chunk.get("done"):
                        break
    except httpx.TimeoutException:
        yield "\n\n_El modelo está tardando demasiado en responder. Intenta con una pregunta más corta o vuelve a intentarlo en unos segundos._"
    except (httpx.HTTPError, json.JSONDecodeError):
        yield "\n\n_No se pudo obtener respuesta del asistente (Ollama no respondió correctamente). Verifica que esté corriendo e intenta de nuevo._"
