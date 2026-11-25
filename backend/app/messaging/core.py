"""Publish tasks, results and events; run consumers with validation, idempotency, retry and dead-letter.

Every task, result and event (except event.agent_message itself) is:
  1. validated against app.schemas.contracts,
  2. written to the agent_messages table,
  3. published to RabbitMQ,
  4. copied to event.agent_message (with latency, tokens and cost) for the live agent map.
"""

import asyncio
import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.core.config import settings
from app.core.db import session_scope
from app.llm.usage import UsageTotals, current_usage
from app.messaging.broker import Delivery, InMemoryBroker, RabbitBroker
from app.models import AgentMessage, ProcessedMessage
from app.schemas.contracts import ACTIONS, EVENTS
from app.schemas.envelope import Envelope

logger = logging.getLogger(__name__)

RESULTS_QUEUE = "orchestrator.results"
RESULT_ROUTING_KEY = "result.orchestrator"
AGENT_MESSAGE_EVENT = "event.agent_message"
RETRY_HEADER = "x-retry-count"
RETRY_BASE_DELAY_SECONDS = 1.0

EnvelopeHandler = Callable[[Envelope], Awaitable[None]]

_broker: RabbitBroker | InMemoryBroker | None = None


class ContractError(ValueError):
    """A payload does not match the shared contract."""


def get_broker() -> RabbitBroker | InMemoryBroker:
    global _broker
    if _broker is None:
        _broker = RabbitBroker(settings.rabbitmq_url)
    return _broker


def set_broker(broker: RabbitBroker | InMemoryBroker | None) -> None:
    """Tests use this to install an InMemoryBroker."""
    global _broker
    _broker = broker


def task_routing_key(agent: str) -> str:
    return f"task.{agent}"


def agent_queue(agent: str) -> str:
    return f"agent.{agent}"


def _json_ready(model_or_dict: Any) -> dict:
    if hasattr(model_or_dict, "model_dump"):
        return model_or_dict.model_dump(mode="json", by_alias=True)
    return json.loads(json.dumps(model_or_dict, default=str))


def validate_task_payload(agent: str, action: str, payload: dict) -> dict:
    contract = ACTIONS.get((agent, action))
    if contract is None:
        raise ContractError(f"Unknown action {agent}.{action}")
    try:
        return _json_ready(contract[0].model_validate(payload))
    except ValidationError as error:
        raise ContractError(f"Bad payload for {agent}.{action}: {error}") from error


def validate_result_payload(agent: str, action: str, payload: dict) -> dict:
    contract = ACTIONS.get((agent, action))
    if contract is None:
        raise ContractError(f"Unknown action {agent}.{action}")
    try:
        return _json_ready(contract[1].model_validate(payload))
    except ValidationError as error:
        raise ContractError(f"Bad result for {agent}.{action}: {error}") from error


def validate_event_data(routing_key: str, data: dict) -> dict:
    if routing_key not in EVENTS:
        raise ContractError(f"Unknown event {routing_key}")
    model = EVENTS[routing_key]
    if model is None:
        return data
    try:
        return _json_ready(model.model_validate(data))
    except ValidationError as error:
        raise ContractError(f"Bad data for {routing_key}: {error}") from error


async def _record_and_publish(
    routing_key: str,
    envelope: Envelope,
    latency_ms: int | None = None,
    usage: UsageTotals | None = None,
    headers: dict | None = None,
) -> None:
    usage = usage or UsageTotals()
    async with session_scope() as session:
        session.add(
            AgentMessage(
                message_id=envelope.message_id,
                correlation_id=envelope.correlation_id,
                order_id=envelope.order_id,
                message_type=envelope.type,
                from_agent=envelope.from_agent,
                to_agent=envelope.to_agent,
                action=envelope.action,
                status=envelope.status,
                payload=envelope.payload,
                notes=envelope.notes,
                attempt=envelope.attempt,
                in_reply_to=envelope.in_reply_to,
                latency_ms=latency_ms,
                tokens_in=usage.tokens_in,
                tokens_out=usage.tokens_out,
                cost_usd=usage.cost_usd,
                sent_at=envelope.sent_at,
            )
        )
    broker = get_broker()
    await broker.publish(routing_key, envelope.model_dump_json().encode(), headers)
    copy = envelope.model_dump(mode="json") | {
        "latency_ms": latency_ms,
        "tokens_in": usage.tokens_in,
        "tokens_out": usage.tokens_out,
        "cost_usd": float(usage.cost_usd),
    }
    await broker.publish(AGENT_MESSAGE_EVENT, json.dumps(copy).encode())


async def publish_task(
    to_agent: str,
    action: str,
    order_id: uuid.UUID | None,
    payload: dict | Any,
    correlation_id: uuid.UUID | None = None,
    attempt: int = 1,
    timeout_seconds: int | None = None,
) -> Envelope:
    """Orchestrator -> agent. Returns the envelope (keep message_id to match the result)."""
    clean_payload = validate_task_payload(to_agent, action, _json_ready(payload))
    timeout = timeout_seconds or settings.task_default_timeout_seconds
    envelope = Envelope(
        correlation_id=correlation_id,
        order_id=order_id,
        type="task",
        from_agent="orchestrator",
        to_agent=to_agent,
        action=action,
        payload=clean_payload,
        attempt=attempt,
        reply_by=datetime.now(UTC) + timedelta(seconds=timeout),
    )
    await _record_and_publish(task_routing_key(to_agent), envelope)
    return envelope


async def publish_result(
    task: Envelope, status: str, payload: dict | Any | None = None, notes: str | None = None
) -> Envelope:
    """Agent -> orchestrator. A 'failed' result needs no payload; 'ok'/'partial' must match the contract."""
    raw_payload = _json_ready(payload or {})
    if status == "failed":
        clean_payload = raw_payload
    else:
        clean_payload = validate_result_payload(task.to_agent, task.action, raw_payload)
    envelope = Envelope(
        correlation_id=task.correlation_id,
        order_id=task.order_id,
        type="result",
        from_agent=task.to_agent,
        to_agent="orchestrator",
        action=task.action,
        payload=clean_payload,
        status=status,
        notes=notes,
        attempt=task.attempt,
        in_reply_to=task.message_id,
    )
    latency_ms = int((envelope.sent_at - task.sent_at).total_seconds() * 1000)
    await _record_and_publish(RESULT_ROUTING_KEY, envelope, latency_ms, current_usage.get())
    return envelope


async def publish_event(
    routing_key: str, data: dict | Any, from_agent: str = "api", order_id: uuid.UUID | None = None
) -> Envelope:
    clean_data = validate_event_data(routing_key, _json_ready(data))
    if order_id is None and isinstance(clean_data.get("order_id"), str):
        order_id = uuid.UUID(clean_data["order_id"])
    envelope = Envelope(
        type="event", from_agent=from_agent, action=routing_key, payload=clean_data, order_id=order_id
    )
    await _record_and_publish(routing_key, envelope)
    return envelope


async def _already_processed(message_id: uuid.UUID, consumer: str) -> bool:
    async with session_scope() as session:
        found = await session.scalar(
            select(ProcessedMessage.id).where(
                ProcessedMessage.message_id == message_id, ProcessedMessage.consumer == consumer
            )
        )
        return found is not None


async def _mark_processed(message_id: uuid.UUID, consumer: str) -> None:
    async with session_scope() as session:
        statement = insert(ProcessedMessage).values(id=uuid.uuid4(), message_id=message_id, consumer=consumer)
        await session.execute(statement.on_conflict_do_nothing(constraint="message_consumer"))


def is_transient(error: BaseException) -> bool:
    """Errors worth retrying: the network, the database connection or an overloaded AI provider.
    Bad data (ValueError, validation errors, unparseable AI replies) fails the same way every time,
    so retrying it only repeats the work and the AI cost."""
    from sqlalchemy.exc import DBAPIError, OperationalError

    from app.llm.client import LlmUnavailable

    if isinstance(error, LlmUnavailable):
        return error.retryable
    if isinstance(error, OperationalError):
        return True
    if isinstance(error, DBAPIError):
        return bool(error.connection_invalidated)
    return isinstance(error, (ConnectionError, TimeoutError, asyncio.TimeoutError, OSError))


def make_delivery_handler(consumer: str, handler: EnvelopeHandler, max_attempts: int | None = None):
    """Wraps an envelope handler with schema checks, idempotency, retries and dead-lettering."""
    attempts_allowed = max_attempts or settings.task_max_attempts

    async def handle_delivery(delivery: Delivery) -> bool:
        try:
            envelope = Envelope.model_validate_json(delivery.body)
            if envelope.type == "task":
                validate_task_payload(envelope.to_agent, envelope.action, envelope.payload)
        except (ValidationError, ContractError):
            logger.exception("%s: invalid message, sending to dead-letter queue", consumer)
            return False

        if await _already_processed(envelope.message_id, consumer):
            logger.info("%s: skipping duplicate message %s", consumer, envelope.message_id)
            return True

        retry_count = int(delivery.headers.get(RETRY_HEADER, 0))
        usage_token = current_usage.set(UsageTotals())
        try:
            await handler(envelope)
        except Exception as error:
            retryable = is_transient(error)
            logger.exception(
                "%s: handler failed on %s (retry %s, retryable %s)",
                consumer,
                envelope.action,
                retry_count,
                retryable,
            )
            if retryable and retry_count + 1 < attempts_allowed:
                await asyncio.sleep(RETRY_BASE_DELAY_SECONDS * (2**retry_count))
                await get_broker().publish(
                    delivery.routing_key, delivery.body, delivery.headers | {RETRY_HEADER: retry_count + 1}
                )
                return True  # the retry copy is now in the queue
            if envelope.type == "task":
                await publish_result(
                    envelope,
                    "failed",
                    {"error": str(error)[:500], "retryable": retryable},
                    notes="Handler failed",
                )
            return False  # dead-letter the original
        finally:
            current_usage.reset(usage_token)

        await _mark_processed(envelope.message_id, consumer)
        return True

    return handle_delivery


async def run_consumer(
    queue_name: str,
    handler: EnvelopeHandler,
    bindings: list[str] | None = None,
    prefetch: int = 10,
    consumer_name: str | None = None,
) -> None:
    """Consume a queue forever.

    Agents: run_consumer("agent.material", handle)  (bound to task.material automatically)
    Orchestrator results: run_consumer("orchestrator.results", handle)
    Events: run_consumer("monitoring.events", handle, bindings=["event.machine.raw"])
    """
    if bindings is None:
        if queue_name == RESULTS_QUEUE:
            bindings = [RESULT_ROUTING_KEY]
        elif queue_name.startswith("agent."):
            bindings = [task_routing_key(queue_name.removeprefix("agent."))]
        else:
            raise ValueError(f"Give bindings for queue {queue_name}")
    delivery_handler = make_delivery_handler(consumer_name or queue_name, handler)
    await get_broker().consume(queue_name, bindings, delivery_handler, prefetch)


__all__ = [
    "ContractError",
    "get_broker",
    "set_broker",
    "publish_task",
    "publish_result",
    "publish_event",
    "run_consumer",
    "make_delivery_handler",
    "agent_queue",
    "task_routing_key",
    "RESULTS_QUEUE",
    "RESULT_ROUTING_KEY",
    "AGENT_MESSAGE_EVENT",
]
