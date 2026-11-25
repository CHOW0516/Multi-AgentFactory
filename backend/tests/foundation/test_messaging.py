import json
import uuid

import pytest
from sqlalchemy import func, select

from app.messaging import (
    AGENT_MESSAGE_EVENT,
    ContractError,
    make_delivery_handler,
    publish_event,
    publish_result,
    publish_task,
)
from app.messaging.broker import Delivery, InMemoryBroker, topic_matches
from app.models import AgentMessage
from app.schemas.envelope import Envelope


def test_topic_matching():
    assert topic_matches("event.*", "event.notification")
    assert not topic_matches("event.*", "event.order.received")
    assert topic_matches("event.#", "event.order.received")
    assert topic_matches("task.material", "task.material")
    assert not topic_matches("task.material", "task.planning")


async def test_publish_task_validates_payload():
    with pytest.raises(ContractError):
        await publish_task("material", "check_and_hold", None, {"wrong": "field"})
    with pytest.raises(ContractError):
        await publish_task("material", "no_such_action", None, {})


async def test_task_is_logged_published_and_copied(fake_broker, db_session):
    order_id = uuid.uuid4()
    task = await publish_task("material", "check_and_hold", order_id, {"order_id": str(order_id)})
    assert [item.routing_key for item in fake_broker.published] == ["task.material", AGENT_MESSAGE_EVENT]
    copy = json.loads(fake_broker.published[1].body)
    assert copy["message_id"] == str(task.message_id) and copy["tokens_in"] == 0
    stored = await db_session.scalar(select(AgentMessage).where(AgentMessage.message_id == task.message_id))
    assert stored.to_agent == "material" and stored.message_type == "task"


async def test_result_validates_and_reports_latency(fake_broker):
    order_id = uuid.uuid4()
    task = await publish_task("material", "recheck_holds", order_id, {"order_id": str(order_id)})
    with pytest.raises(ContractError):
        await publish_result(task, "ok", {"valid": "maybe"})
    result = await publish_result(task, "ok", {"valid": True, "changes": []})
    assert result.in_reply_to == task.message_id and result.to_agent == "orchestrator"
    copy = json.loads(fake_broker.published_to(AGENT_MESSAGE_EVENT)[-1].body)
    assert copy["latency_ms"] >= 0
    assert fake_broker.published_to("result.orchestrator")


async def test_event_validation_and_alias(fake_broker):
    with pytest.raises(ContractError):
        await publish_event("event.unknown", {})
    machine_id = uuid.uuid4()
    await publish_event(
        "event.machine.unavailable",
        {"machine_id": str(machine_id), "from": "2026-12-01T08:00:00Z", "to": None, "reason": "breakdown"},
        from_agent="maintenance",
    )
    body = json.loads(fake_broker.published_to("event.machine.unavailable")[0].body)
    assert body["payload"]["from"].startswith("2026-12-01")


def task_delivery(action="check_and_hold", agent="material") -> tuple[Envelope, Delivery]:
    order_id = uuid.uuid4()
    envelope = Envelope(
        type="task",
        from_agent="orchestrator",
        to_agent=agent,
        action=action,
        order_id=order_id,
        payload={"order_id": str(order_id)},
    )
    return envelope, Delivery(f"task.{agent}", envelope.model_dump_json().encode(), {})


async def test_same_message_twice_runs_handler_once():
    calls = []

    async def handler(envelope):
        calls.append(envelope.message_id)

    handle = make_delivery_handler("test-consumer", handler)
    _envelope, delivery = task_delivery()
    assert await handle(delivery) is True
    assert await handle(delivery) is True
    assert len(calls) == 1


async def test_invalid_message_goes_to_dead_letter():
    async def handler(envelope):
        raise AssertionError("should not run")

    handle = make_delivery_handler("test-consumer", handler)
    assert await handle(Delivery("task.material", b"{not json", {})) is False
    envelope, _ = task_delivery()
    bad = envelope.model_copy(update={"payload": {"nope": 1}})
    assert await handle(Delivery("task.material", bad.model_dump_json().encode(), {})) is False


async def test_failing_handler_retries_then_dead_letters_and_reports(monkeypatch, db_session):
    import app.messaging.core as core

    monkeypatch.setattr(core, "RETRY_BASE_DELAY_SECONDS", 0)
    broker = InMemoryBroker(deliver=True)
    core.set_broker(broker)
    calls = []

    async def handler(envelope):
        calls.append(1)
        raise ConnectionError("boom")  # transient, so it is retried

    await core.run_consumer("agent.material", handler)
    envelope, _ = task_delivery()
    await broker.publish("task.material", envelope.model_dump_json().encode())
    assert len(calls) == 3  # TASK_MAX_ATTEMPTS default
    assert [queue for queue, _ in broker.dead_letters] == ["agent.material"]
    failed = [json.loads(item.body) for item in broker.published_to("result.orchestrator")]
    assert failed[0]["status"] == "failed" and "boom" in failed[0]["payload"]["error"]
    count = await db_session.scalar(
        select(func.count()).select_from(AgentMessage).where(AgentMessage.status == "failed")
    )
    assert count == 1


async def test_permanent_error_is_not_retried(monkeypatch, db_session):
    import app.messaging.core as core

    monkeypatch.setattr(core, "RETRY_BASE_DELAY_SECONDS", 0)
    broker = InMemoryBroker(deliver=True)
    core.set_broker(broker)
    calls = []

    async def handler(envelope):
        calls.append(1)
        raise ValueError("Order requires verified lines")

    await core.run_consumer("agent.material", handler)
    envelope, _ = task_delivery()
    await broker.publish("task.material", envelope.model_dump_json().encode())
    assert len(calls) == 1
    failed = [json.loads(item.body) for item in broker.published_to("result.orchestrator")]
    assert failed[0]["payload"]["retryable"] is False


async def test_handler_llm_usage_is_reported_on_result(fake_ai, fake_broker, monkeypatch):
    from app.core.config import get_settings
    from app.llm import call_ai, model_for, pricing

    monkeypatch.setattr(get_settings(), "ai_prices", json.dumps({model_for("material"): [1, 1]}))
    pricing.prices.cache_clear()

    fake_ai.add_response(text="ok", tokens_in=1000, tokens_out=200)

    async def handler(envelope):
        await call_ai("material", "explain", messages=[{"role": "user", "content": "hi"}])
        await publish_result(envelope, "ok", {"valid": True, "changes": []})

    envelope, delivery = task_delivery(action="recheck_holds")
    assert await make_delivery_handler("material", handler)(delivery)
    copy = json.loads(fake_broker.published_to(AGENT_MESSAGE_EVENT)[-1].body)
    assert copy["tokens_in"] == 1000 and copy["tokens_out"] == 200 and copy["cost_usd"] > 0
    pricing.prices.cache_clear()
