from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.services.chat_service import stream_chat

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = []
    context: str | None = None


@router.post("/stream")
async def chat_stream(req: ChatRequest):
    async def gen():
        async for token in stream_chat(req.message, [m.model_dump() for m in req.history], req.context):
            yield token
    return StreamingResponse(gen(), media_type="text/plain")
