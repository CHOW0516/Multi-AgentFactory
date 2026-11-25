import asyncio
import json
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime

import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.db import session_scope
from app.core.security import decode_access_token
from app.messaging import InMemoryBroker, get_broker
from app.models import User


@asynccontextmanager
async def expose_desktop_url(app):
    # Foundation discovers routers under /api. The desktop also has a contracted root URL.
    if not any(getattr(route, "path", None) == "/ws" for route in app.routes):
        app.add_api_websocket_route("/ws", websocket)
    yield


router = APIRouter(tags=["live events"], lifespan=expose_desktop_url)
EVENT_TYPES = {
    f"event.{event}": event.replace(".", "_")
    for event in (
        "agent_message",
        "order.state_changed",
        "approval.created",
        "machine.status_changed",
        "notification",
    )
}
PUBLIC_MESSAGE_FIELDS = {
    "message_id",
    "correlation_id",
    "order_id",
    "type",
    "message_type",
    "from_agent",
    "to_agent",
    "action",
    "status",
    "latency_ms",
    "tokens_in",
    "tokens_out",
    "sent_at",
    "attempt",
    "in_reply_to",
    "reply_by",
}


def project_event(routing_key, envelope, user_id, role):
    if routing_key not in EVENT_TYPES:
        return None
    data = envelope if routing_key == "event.agent_message" else envelope.get("payload", {})
    if routing_key == "event.agent_message" and data.get("action") == "event.notification":
        notification = data.get("payload", {})
        if str(user_id) not in {str(identifier) for identifier in notification.get("user_ids", [])}:
            return None
        data = {**data, "payload": {**notification, "user_ids": [str(user_id)]}}
    if routing_key == "event.notification":
        if str(user_id) not in {str(identifier) for identifier in data.get("user_ids", [])}:
            return None
        data = {**data, "user_ids": [str(user_id)]}
    elif role == "store" and routing_key == "event.agent_message":
        data = {key: value for key, value in data.items() if key in PUBLIC_MESSAGE_FIELDS}
        data |= {"payload": {}, "notes": None, "cost_usd": 0}
    elif role == "store" and routing_key == "event.approval.created":
        return None
    return {
        "type": EVENT_TYPES[routing_key],
        "data": data,
        "at": envelope.get("sent_at") or datetime.now(UTC).isoformat(),
    }


@asynccontextmanager
async def subscribe():
    broker = get_broker()
    frames = asyncio.Queue(maxsize=256)
    queue_name = f"p3.live.{uuid.uuid4()}"

    def deliver(key, body):
        if frames.full():
            frames.get_nowait()
        frames.put_nowait((key, body))

    if isinstance(broker, InMemoryBroker):

        async def on_delivery(message):
            deliver(message.routing_key, message.body)
            return True

        entry = (queue_name, list(EVENT_TYPES), on_delivery)
        broker.consumers.append(entry)
        try:
            yield frames
        finally:
            broker.consumers.remove(entry)
        return

    await broker.connect()
    async with broker.connection.channel() as channel:
        queue = await channel.declare_queue(queue_name, exclusive=True, auto_delete=True)
        for key in EVENT_TYPES:
            await queue.bind("factory", routing_key=key)

        async def on_message(message):
            deliver(message.routing_key, message.body)

        await queue.consume(on_message, no_ack=True)
        yield frames


@router.websocket("/ws")
async def websocket(socket: WebSocket, token: str = ""):
    try:
        claims = decode_access_token(token)
        user_id = uuid.UUID(claims["sub"])
    except (ValueError, TypeError, KeyError, jwt.PyJWTError):
        await socket.close(code=1008)
        return
    async with session_scope() as session:
        user = await session.get(User, user_id)
        if not user or not user.is_active:
            await socket.close(code=1008)
            return
        role = user.role
    try:
        async with subscribe() as frames:
            await socket.accept()
            reader = asyncio.create_task(socket.receive())
            frame = asyncio.create_task(frames.get())
            try:
                loop = asyncio.get_running_loop()
                heartbeat_at = loop.time() + 20
                while True:
                    if datetime.now(UTC).timestamp() >= claims["exp"]:
                        await socket.close(code=1008)
                        break
                    done, _ = await asyncio.wait(
                        (reader, frame),
                        timeout=max(0, heartbeat_at - loop.time()),
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    if reader in done:
                        if reader.result()["type"] == "websocket.disconnect":
                            break
                        reader = asyncio.create_task(socket.receive())
                    if frame in done:
                        key, body = frame.result()
                        try:
                            event = project_event(key, json.loads(body), user_id, role)
                        except (ValueError, AttributeError, TypeError):
                            event = None
                        if event:
                            await socket.send_json(event)
                        frame = asyncio.create_task(frames.get())
                    if loop.time() >= heartbeat_at:
                        await socket.send_json(
                            {"type": "heartbeat", "data": {}, "at": datetime.now(UTC).isoformat()}
                        )
                        heartbeat_at = loop.time() + 20
            finally:
                reader.cancel()
                frame.cancel()
                await asyncio.gather(reader, frame, return_exceptions=True)
    except WebSocketDisconnect:
        pass
