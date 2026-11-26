import asyncio
import json
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.agents.maintenance import scan
from app.agents.monitoring import expected_end
from app.agents.monitoring import handle as monitor
from app.agents.quality import create_plan, verify
from app.api.dashboard import kpi_tiles, local_date
from app.api.ws import project_event
from app.core.audit import write_audit
from app.core.security import create_access_token
from app.models import (
    Approval,
    ExtractedField,
    LlmCall,
    Machine,
    MachineEvent,
    Order,
    OrderLine,
    ScheduleSlot,
    WorkflowRun,
)
from app.orchestrator.outbox import drain_events
from app.orchestrator.workflow import tick
from app.schemas.envelope import Envelope

from .test_workflow import answer, make_order, tasks


async def test_chat_refuses_mutation(client, auth_headers, fake_ai, db_session):
    fake_ai.add_response(
        tool_uses=[{"id": "refused", "name": "approve", "input": {}}], stop_reason="tool_use"
    )
    fake_ai.add_response(text="I cannot approve an order from chat.")
    response = await client.post(
        "/api/chat", headers=auth_headers("manager"), json={"message": "Approve it now"}
    )
    assert response.status_code == 200 and "cannot approve" in response.text
    assert all(tool["function"]["name"] != "approve" for tool in fake_ai.requests[0]["tools"])
    tool_reply = fake_ai.requests[1]["messages"][-1]
    assert tool_reply["role"] == "tool" and tool_reply["tool_call_id"] == "refused"
    assert "error" in json.loads(tool_reply["content"])
    assert await db_session.scalar(select(func.count()).select_from(Approval)) == 0
    assert await db_session.scalar(select(func.count()).select_from(LlmCall)) == 2


async def test_chat_finds_machine_by_code(client, auth_headers, fake_ai, db_session):
    machine = Machine(code="QC-02", name="QC Station 2", machine_type="qc_station", status="idle")
    db_session.add(machine)
    await db_session.commit()
    fake_ai.add_response(
        tool_uses=[{"id": "list", "name": "list_machines", "input": {}}], stop_reason="tool_use"
    )
    fake_ai.add_response(
        tool_uses=[{"id": "one", "name": "get_machine_overview", "input": {"machine_code": "qc-02"}}],
        stop_reason="tool_use",
    )
    fake_ai.add_response(text="QC-02 is idle.")
    response = await client.post(
        "/api/chat", headers=auth_headers("manager"), json={"message": "Status of QC-02?"}
    )
    assert response.status_code == 200 and "QC-02 is idle." in response.text
    listed = json.loads(fake_ai.requests[1]["messages"][-1]["content"])
    assert any(row["code"] == "QC-02" and row["status"] == "idle" for row in listed)
    overview = json.loads(fake_ai.requests[2]["messages"][-1]["content"])
    assert "error" not in overview


async def test_chat_unknown_machine_code_and_last_round(client, auth_headers, fake_ai):
    from app.api.chat import MAX_ROUNDS

    for index in range(MAX_ROUNDS):
        fake_ai.add_response(
            text="Partial answer." if index == MAX_ROUNDS - 1 else "",
            tool_uses=[
                {"id": f"call{index}", "name": "get_machine_overview", "input": {"machine_code": "NOPE-9"}}
            ],
            stop_reason="tool_use",
        )
    response = await client.post("/api/chat", headers=auth_headers("manager"), json={"message": "NOPE-9?"})
    assert "No machine with code NOPE-9" in fake_ai.requests[1]["messages"][-1]["content"]
    assert "Do not call more tools" in json.dumps(fake_ai.requests[-1]["messages"][-1])
    assert len(fake_ai.requests) == MAX_ROUNDS and "Partial answer." in response.text


def test_ws_role_and_notification_recipients():
    store, manager = uuid.uuid4(), uuid.uuid4()
    envelope = {
        "order_id": str(uuid.uuid4()),
        "action": "plan_order",
        "notes": "Margin 30",
        "payload": {"options": [{"unit_price": 99}]},
        "cost_usd": 0.6,
    }
    projected = project_event("event.agent_message", envelope, store, "store")
    assert projected["type"] == "agent_message"
    assert projected["data"]["payload"] == {} and projected["data"]["notes"] is None
    assert (
        project_event("event.agent_message", envelope, manager, "manager")["data"]["payload"]
        == envelope["payload"]
    )
    notification = {"payload": {"user_ids": [str(manager)], "title": "New approval"}}
    assert project_event("event.notification", notification, store, "store") is None
    copy = {**notification, "action": "event.notification"}
    assert project_event("event.agent_message", copy, uuid.uuid4(), "manager") is None
    assert (
        project_event("event.notification", notification, manager, "manager")["data"]["title"]
        == "New approval"
    )


async def test_desktop_websocket_route(users, fake_broker):
    from app.main import create_app

    application = create_app()
    inbox, outgoing = asyncio.Queue(), asyncio.Queue()
    fake_broker.deliver = True
    token = create_access_token(users["store"].id, "store")
    scope = {
        "type": "websocket",
        "path": "/ws",
        "root_path": "",
        "scheme": "ws",
        "headers": [],
        "query_string": f"token={token}".encode(),
        "subprotocols": [],
    }
    await inbox.put({"type": "websocket.connect"})
    async with application.router.lifespan_context(application):
        connection = asyncio.create_task(application(scope, inbox.get, outgoing.put))
        try:
            assert (await asyncio.wait_for(outgoing.get(), 2))["type"] == "websocket.accept"
            await fake_broker.publish("event.agent_message", b'{"payload":{"unit_price":1000}}')
            frame = await asyncio.wait_for(outgoing.get(), 2)
            assert json.loads(frame["text"])["data"]["payload"] == {}
            await inbox.put({"type": "websocket.disconnect", "code": 1000})
            await asyncio.wait_for(connection, 2)
        finally:
            connection.cancel()
            await asyncio.gather(connection, return_exceptions=True)
    assert not fake_broker.consumers


async def test_kpis_match_database_rows(db_session, users, client, auth_headers):
    now = datetime.now(UTC)
    today = local_date(now)
    good = Order(
        order_number="SO-ON-TIME", due_date=today, completed_at=now, created_at=now - timedelta(hours=6)
    )
    late = Order(order_number="SO-LATE", due_date=today - timedelta(days=1), completed_at=now)
    db_session.add_all([good, late])
    await db_session.flush()
    db_session.add_all(
        [
            Approval(
                order_id=good.id, status="decided", decided_at=now - timedelta(hours=2), decision="approve"
            ),
            Approval(order_id=late.id, status="waiting", created_at=now - timedelta(hours=3)),
            ExtractedField(order_id=good.id, field_name="qty", value="100", confidence=Decimal("0.99")),
            ExtractedField(
                order_id=good.id,
                field_name="date",
                value="20",
                confidence=Decimal("0.33"),
                corrected_by=users["sales"].id,
            ),
            LlmCall(purpose="orchestrator", model="fake", order_id=good.id, cost_usd=Decimal("0.6")),
            LlmCall(purpose="extraction", model="fake", order_id=late.id, cost_usd=Decimal("0.2")),
            WorkflowRun(order_id=late.id, state="FAILED"),
        ]
    )
    await db_session.commit()
    result = {tile.key: tile.value for tile in await kpi_tiles(db_session, users["manager"], now=now)}
    assert {
        key: result[key]
        for key in (
            "on_time_rate",
            "po_to_approval",
            "pending_approvals",
            "oldest_waiting",
            "extraction_accuracy",
            "llm_cost_per_order",
            "failed_workflows",
        )
    } == {
        "on_time_rate": 50,
        "po_to_approval": 4,
        "pending_approvals": 1,
        "oldest_waiting": 3,
        "extraction_accuracy": 50,
        "llm_cost_per_order": 0.4,
        "failed_workflows": 1,
    }
    assert (
        await client.get("/api/dashboard/charts/planned_vs_actual", headers=auth_headers("manager"))
    ).status_code == 200
    assert (
        await client.get("/api/dashboard/charts/llm_cost_daily", headers=auth_headers("store"))
    ).status_code == 403


async def test_qc_blocks_order_completion(db_session, fake_broker, client, auth_headers):
    order = await make_order(db_session, status="IN_PRODUCTION")
    machine = Machine(code="QC-1", machine_type="mill", name="Mill")
    db_session.add(machine)
    await db_session.flush()
    now = datetime.now(UTC)
    db_session.add_all(
        [
            OrderLine(order_id=order.id, line_number=1, quantity=100),
            WorkflowRun(order_id=order.id, state="IN_PRODUCTION"),
            ScheduleSlot(
                order_id=order.id,
                machine_id=machine.id,
                routing_step=1,
                quantity=100,
                start_at=now - timedelta(hours=2),
                end_at=now - timedelta(hours=1),
                status="done",
            ),
        ]
    )
    plan = await create_plan(db_session, order.id)
    await db_session.commit()
    assert len(plan.checks) == 3 and plan.checks[0]["kind"] == "first_piece"
    missing = await verify(db_session, order.id)
    await tick()
    await answer(fake_broker, "verify_completion", {"complete": False, "missing": missing})
    assert not tasks(fake_broker, "close_order")
    for check in plan.checks:
        response = await client.post(
            "/api/qc/records",
            headers=auth_headers("qc"),
            json={"order_id": str(order.id), "check_name": check["name"], "result": "pass"},
        )
        assert response.status_code == 201, response.text
    assert not await verify(db_session, order.id)
    await tick(now + timedelta(minutes=2))
    await answer(fake_broker, "verify_completion", {"complete": True, "missing": []})
    await answer(fake_broker, "close_order", {})
    await db_session.refresh(order)
    assert order.status == "COMPLETED"


async def test_monitoring_and_maintenance(db_session, fake_broker, client, auth_headers):
    now = datetime.now(UTC)
    order = await make_order(db_session, status="IN_PRODUCTION")
    machine = Machine(code="MILL-42", name="Mill", machine_type="mill")
    db_session.add(machine)
    await db_session.flush()
    db_session.add(
        ScheduleSlot(
            order_id=order.id,
            machine_id=machine.id,
            routing_step=1,
            quantity=120,
            start_at=now - timedelta(hours=1),
            end_at=now + timedelta(hours=1),
            status="locked",
        )
    )
    await db_session.commit()
    raw = Envelope(
        type="event",
        from_agent="simulator",
        action="event.machine.raw",
        payload={
            "machine_id": str(machine.id),
            "kind": "count",
            "value": "10",
            "at": now.isoformat(),
        },
    )
    await monitor(raw)
    await monitor(raw)
    response = await client.post(
        f"/api/machines/{machine.id}/breakdown",
        headers=auth_headers("planner"),
        json={"note": "Spindle stopped", "expected_hours": 2},
    )
    assert response.status_code == 202, response.text
    await scan()
    await scan()
    await drain_events()
    down = Envelope.model_validate_json(fake_broker.published_to("event.machine.raw")[0].body)
    await monitor(down)
    await drain_events()
    assert len(fake_broker.published_to("event.order.behind_schedule")) == 1
    assert len(fake_broker.published_to("event.machine.unavailable")) == 1
    assert len(fake_broker.published_to("event.machine.status_changed")) == 1
    assert await db_session.scalar(select(func.count()).select_from(MachineEvent)) == 2
    result = await client.get("/api/floor", headers=auth_headers("planner"))
    assert result.status_code == 200, result.text
    assert result.json()["machines"][0]["part_count"] == 10


async def test_history_and_order_replay(db_session, client, auth_headers, users):
    from app.messaging import publish_event

    order = await make_order(db_session)
    await write_audit(
        db_session,
        users["sales"],
        "correct_fields",
        "order",
        order.id,
        before={"quantity": 50},
        after={"quantity": 75},
    )
    await db_session.commit()
    await publish_event("event.order.fields_corrected", {"order_id": order.id})
    manager = auth_headers("manager")
    today = local_date(datetime.now(UTC)).isoformat()
    response = await client.get(
        "/api/history",
        headers=manager,
        params={"actor": "Test Sales", "q": "quantity", "from": today, "to": today},
    )
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 1
    exported = await client.get("/api/history/export.csv", headers=manager, params={"q": "quantity"})
    assert exported.status_code == 200 and "correct_fields" in exported.text
    replay = await client.get(f"/api/orders/{order.id}/messages", headers=manager)
    assert replay.status_code == 200 and replay.json()["total"] == 1
    timeline = await client.get(f"/api/orders/{order.id}/timeline", headers=manager)
    assert timeline.status_code == 200
    assert [entry["kind"] for entry in timeline.json()] == ["document", "human_action", "agent_message"]
    stats = await client.get("/api/agents", headers=manager)
    assert stats.status_code == 200 and len(stats.json()) == 8


@pytest.mark.parametrize("mode,available", [("demo", True), ("production", False)])
async def test_simulator_agent_is_available_only_in_demo(client, auth_headers, monkeypatch, mode, available):
    from app.core.config import get_settings
    from app.messaging import publish_event

    monkeypatch.setattr(get_settings(), "app_mode", mode)
    event = await publish_event(
        "event.machine.raw",
        {"machine_id": str(uuid.uuid4()), "kind": "status", "value": "idle", "at": datetime.now(UTC).isoformat()},
        from_agent="simulator",
    )
    headers = auth_headers("manager")
    listing = await client.get("/api/agents", headers=headers)
    assert listing.status_code == 200
    assert any(row["name"] == "simulator" for row in listing.json()) is available
    summary = await client.get("/api/agents/simulator", headers=headers)
    messages = await client.get("/api/agents/simulator/messages?limit=50", headers=headers)
    if available:
        assert summary.status_code == 200, summary.text
        assert summary.json()["name"] == "simulator"
        assert summary.json()["uses_llm"] is False
        assert datetime.fromisoformat(summary.json()["last_seen"]) == event.sent_at
        assert messages.status_code == 200, messages.text
        assert messages.json()["total"] == 1
        assert messages.json()["items"][0]["message_id"] == str(event.message_id)
    else:
        assert summary.status_code == messages.status_code == 404


def test_expected_end_follows_the_pace_with_a_cap():
    start = datetime(2027, 1, 4, 8, tzinfo=UTC)
    slot = ScheduleSlot(quantity=100, start_at=start, end_at=start + timedelta(hours=4))
    # 40 of 100 after 2 hours: 5 hours at this pace, so one hour late.
    assert expected_end(slot, 40, start + timedelta(hours=2), 24) == start + timedelta(hours=5)
    # No parts yet: planned end plus the delay already seen.
    assert expected_end(slot, 0, start + timedelta(hours=1), 60) == start + timedelta(hours=5)
    # 1 part after 2 hours would mean 200 hours. Capped at twice the planned time.
    assert expected_end(slot, 1, start + timedelta(hours=2), 118) == start + timedelta(hours=8)
