import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.core.config import settings
from app.messaging import publish_result
from app.models import Approval, Machine, Notification, Order, PlanOption, SourceDocument, WorkflowRun
from app.orchestrator import machine_replans, workflow
from app.orchestrator.__main__ import handle
from app.orchestrator.outbox import drain_events
from app.schemas.envelope import Envelope


async def make_order(session, **kwargs):
    document = SourceDocument(file_path="order.pdf", file_name="order.pdf", mime_type="application/pdf")
    session.add(document)
    await session.flush()
    order = Order(
        order_number=f"SO-{uuid.uuid4().hex[:12]}",
        source_document_id=document.id,
        due_date=date(2026, 12, 1),
        **kwargs,
    )
    session.add(order)
    await session.commit()
    return order


async def event(name, order=None, **data):
    if order:
        data["order_id"] = str(order.id)
    await handle(Envelope(type="event", from_agent="api", action=f"event.{name}", payload=data))


async def receive(order):
    await event("order.received", order, document_id=str(order.source_document_id))


def tasks(broker, action):
    messages = [Envelope.model_validate_json(item.body) for item in broker.published_to("task.*")]
    return [message for message in messages if message.action == action]


async def answer(broker, action, data, order_id=None):
    await workflow.tick()
    candidates = [task for task in tasks(broker, action) if not order_id or task.order_id == order_id]
    task = candidates[-1]
    result = await publish_result(task, "ok", data)
    await handle(result)
    return result


def extraction(order, fields=None):
    return {"order_id": order.id, "fields_needing_check": fields or [], "quotation_mismatches": []}


def material_result():
    return {
        "material_ready_date": "2026-12-01",
        "shortages": [],
        "hold_ids": [],
        "hold_expires_at": None,
        "data_warnings": [],
    }


async def state(session, order):
    await session.refresh(order)
    return order.status


async def plan(session, broker, order, **kwargs):
    await answer(broker, "check_and_hold", material_result(), order.id)
    option = PlanOption(
        order_id=order.id, option_type="delay", finish_date=date(2026, 12, 2), is_recommended=True, **kwargs
    )
    session.add(option)
    await session.commit()
    await answer(
        broker,
        "plan_order",
        {"plan_option_ids": [option.id], "recommended_option_id": option.id, "can_meet_due_date": False},
        order.id,
    )
    approval = await session.scalar(
        select(Approval).where(Approval.order_id == order.id, Approval.status == "waiting")
    )
    return approval, option


async def pending(session, broker, order):
    await receive(order)
    await answer(broker, "extract_document", extraction(order), order.id)
    return await plan(session, broker, order)


async def decision(client, headers, approval, **body):
    return await client.post(f"/api/approvals/{approval.id}/decision", headers=headers, json=body)


async def test_happy_path_and_duplicate_result(db_session, fake_broker, client, auth_headers):
    order = await make_order(db_session)
    await receive(order)
    first = await answer(fake_broker, "extract_document", extraction(order))
    await handle(first)
    assert await state(db_session, order) == "VERIFIED"
    approval, option = await plan(db_session, fake_broker, order)
    assert await state(db_session, order) == "WAITING_APPROVAL"
    pack = await client.get(f"/api/approvals/{approval.id}", headers=auth_headers("manager"))
    assert pack.status_code == 200, pack.text
    assert pack.json()["plan_options"][0]["id"] == str(option.id)
    assert pack.json()["document_url"] == f"/orders/{order.id}/document"
    assert (await decision(client, auth_headers("sales"), approval, decision="approve")).status_code == 403
    assert (await decision(client, auth_headers("manager"), approval, decision="question")).status_code == 200
    assert await state(db_session, order) == "WAITING_APPROVAL"
    assert (await decision(client, auth_headers("manager"), approval, decision="approve")).status_code == 200
    assert (await decision(client, auth_headers("manager"), approval, decision="approve")).status_code == 409
    for action, payload in (
        ("recheck_holds", {"valid": True, "changes": []}),
        ("recheck_plan", {"valid": True, "changes": []}),
        ("confirm_holds", {}),
        ("lock_plan", {}),
        ("create_purchase_requests", {"purchase_request_ids": []}),
    ):
        await answer(fake_broker, action, payload)
    assert await state(db_session, order) == "CONFIRMED"
    await answer(fake_broker, "create_qc_plan", {"qc_plan_id": uuid.uuid4()})
    await answer(fake_broker, "draft_customer_reply", {"customer_message_id": uuid.uuid4()})
    assert await state(db_session, order) == "REPLY_DRAFTED"
    assert len(tasks(fake_broker, "check_and_hold")) == 1
    await drain_events()
    assert len(fake_broker.published_to("event.order.state_changed")) == 9
    assert len(fake_broker.published_to("event.approval.created")) == 1


async def test_field_correction(db_session, fake_broker):
    order = await make_order(db_session)
    await receive(order)
    await answer(fake_broker, "extract_document", extraction(order, ["due_date"]))
    assert await state(db_session, order) == "NEEDS_FIELD_CHECK"
    await workflow.tick()
    assert not tasks(fake_broker, "check_and_hold")
    await event("order.fields_corrected", order)
    assert await state(db_session, order) == "VERIFIED"


@pytest.mark.parametrize("reason", ["replan", "counter_offer", "decline"])
async def test_rejections(reason, db_session, fake_broker, client, auth_headers):
    order = await make_order(db_session)
    approval, option = await pending(db_session, fake_broker, order)
    headers = auth_headers("manager")
    assert (await decision(client, headers, approval, decision="reject")).status_code == 422
    response = await decision(client, headers, approval, decision="reject", reject_reason=reason)
    assert response.status_code == 200, response.text
    if reason != "counter_offer":
        await answer(fake_broker, "release_holds", {})
        await answer(fake_broker, "release_plan", {})
    if reason == "replan":
        assert await state(db_session, order) == "REPLAN_NEEDED"
        replacement, _ = await plan(db_session, fake_broker, order)
        assert replacement.id != approval.id and replacement.what_changed
    else:
        await answer(fake_broker, "draft_customer_reply", {"customer_message_id": uuid.uuid4()})
        draft = tasks(fake_broker, "draft_customer_reply")[-1]
        assert draft.payload["plan_option_id"] == (str(option.id) if reason == "counter_offer" else None)
        assert await state(db_session, order) == (
            "WAITING_CUSTOMER" if reason == "counter_offer" else "DECLINED"
        )
    if reason == "counter_offer":
        # The plan is locked only when the customer accepts the later date.
        sales = auth_headers("sales")
        accepted = await client.post(
            f"/api/orders/{order.id}/customer-answer", headers=sales, json={"accepted": True}
        )
        assert accepted.status_code == 200, accepted.text
        assert await state(db_session, order) == "RECHECKING"
        await workflow.tick()
        assert tasks(fake_broker, "recheck_holds")


async def test_invalid_recheck_replans(db_session, fake_broker, client, auth_headers):
    order = await make_order(db_session)
    approval, _ = await pending(db_session, fake_broker, order)
    assert (await decision(client, auth_headers("manager"), approval, decision="approve")).status_code == 200
    await answer(fake_broker, "recheck_holds", {"valid": False, "changes": ["Hold expired"]})
    await answer(fake_broker, "recheck_plan", {"valid": True, "changes": []})
    assert await state(db_session, order) == "REPLAN_NEEDED"
    await answer(fake_broker, "release_holds", {})
    await answer(fake_broker, "release_plan", {})
    replacement, _ = await plan(db_session, fake_broker, order)
    assert replacement.id != approval.id and replacement.what_changed == ["Hold expired"]


async def test_revision_releases_resources_before_new_extraction(db_session, fake_broker):
    old_order = await make_order(db_session)
    await receive(old_order)
    new_order = await make_order(db_session, previous_order_id=old_order.id)
    await receive(new_order)
    await event("order.revised", new_order, previous_order_id=str(old_order.id))
    await answer(fake_broker, "release_holds", {})
    await answer(fake_broker, "release_plan", {})
    await workflow.tick()
    assert await state(db_session, old_order) == "REJECTED"
    assert [task.order_id for task in tasks(fake_broker, "extract_document")] == [new_order.id]


async def test_restart_and_timeout(db_session, fake_broker, users):
    order = await make_order(db_session)
    await receive(order)
    await workflow.tick()
    first = tasks(fake_broker, "extract_document")[0]
    run = await db_session.scalar(select(WorkflowRun).where(WorkflowRun.order_id == order.id))
    # Simulate a crash after it was sent, before the pending message ID was committed.
    run.pending_message_id = run.next_timeout_at = None
    await db_session.commit()
    await workflow.tick()
    assert tasks(fake_broker, "extract_document") == [first]
    for _ in range(settings.task_max_attempts):
        await db_session.refresh(run)
        await workflow.tick(run.next_timeout_at + timedelta(seconds=1))
    assert await state(db_session, order) == "FAILED"
    sent = tasks(fake_broker, "extract_document")
    assert [item.attempt for item in sent] == list(range(1, settings.task_max_attempts + 1))
    assert (
        await db_session.scalar(
            select(func.count()).select_from(Notification).where(Notification.kind == "workflow_failed")
        )
        == 2
    )


async def test_reminder_and_escalation(db_session, fake_broker, client, auth_headers, users):
    users["manager"].backup_approver_id = users["planner"].id
    await db_session.commit()
    order = await make_order(db_session)
    approval, _ = await pending(db_session, fake_broker, order)
    assert (await decision(client, auth_headers("planner"), approval, decision="approve")).status_code == 403
    await workflow.tick(approval.created_at + timedelta(hours=settings.approval_reminder_hours))
    await db_session.refresh(approval)
    assert approval.reminded_at is not None and approval.escalated_at is None
    await workflow.tick(approval.created_at + timedelta(hours=settings.approval_escalation_hours))
    assert (await decision(client, auth_headers("planner"), approval, decision="approve")).status_code == 200


async def test_machine_unavailability_creates_replan_approval(db_session, fake_broker):
    order = await make_order(db_session, status="CONFIRMED")
    machine = Machine(code="M-1", machine_type="mill", name="Mill")
    option = PlanOption(order_id=order.id, option_type="delay", finish_date=date(2026, 12, 2))
    db_session.add_all([machine, option])
    await db_session.commit()
    await event(
        "machine.unavailable",
        machine_id=str(machine.id),
        **{
            "from": datetime.now(UTC).isoformat(),
            "to": None,
            "reason": "Breakdown",
        },
    )
    await machine_replans.advance()
    task = tasks(fake_broker, "replan_for_machine")[-1]
    result = await publish_result(
        task,
        "ok",
        {"affected_order_ids": [order.id], "plan_option_ids_by_order": {str(order.id): [option.id]}},
    )
    await handle(result)
    await handle(result)
    approvals = list(await db_session.scalars(select(Approval).where(Approval.order_id == order.id)))
    assert (
        len(approvals) == 1
        and approvals[0].approval_type == "replan"
        and approvals[0].what_changed == ["Breakdown"]
    )


async def test_late_job_creates_replan_approval_for_orders_at_risk(db_session, fake_broker):
    order = await make_order(db_session, status="IN_PRODUCTION")
    machine = Machine(code="LATHE-01", machine_type="lathe", name="Lathe")
    option = PlanOption(order_id=order.id, option_type="delay", finish_date=date(2026, 12, 3))
    db_session.add_all([machine, option])
    db_session.add(WorkflowRun(order_id=order.id, state=order.status, attempts={}))
    await db_session.commit()
    planned_end = datetime.now(UTC)
    await event(
        "order.behind_schedule",
        order,
        minutes_behind=45,
        machine_id=str(machine.id),
        planned_end_at=planned_end.isoformat(),
        expected_end_at=(planned_end + timedelta(hours=3)).isoformat(),
    )
    await machine_replans.advance()
    (task,) = tasks(fake_broker, "replan_for_machine")
    assert task.payload["late_order_id"] == str(order.id)
    assert datetime.fromisoformat(task.payload["unavailable_to"]) == planned_end + timedelta(hours=3)
    result = await publish_result(
        task,
        "ok",
        {"affected_order_ids": [order.id], "plan_option_ids_by_order": {str(order.id): [option.id]}},
    )
    await handle(result)
    (approval,) = await db_session.scalars(select(Approval).where(Approval.order_id == order.id))
    assert approval.approval_type == "replan"
    assert approval.what_changed[0].startswith(f"{order.order_number} is running late on LATHE-01.")
    assert await state(db_session, order) == "WAITING_APPROVAL"


async def test_late_job_that_keeps_due_dates_only_notifies(db_session, fake_broker, users):
    order = await make_order(db_session, status="IN_PRODUCTION")
    machine = Machine(code="LATHE-02", machine_type="lathe", name="Lathe")
    db_session.add(machine)
    db_session.add(WorkflowRun(order_id=order.id, state=order.status, attempts={}))
    await db_session.commit()
    planned_end = datetime.now(UTC)
    await event(
        "order.behind_schedule",
        order,
        minutes_behind=40,
        machine_id=str(machine.id),
        planned_end_at=planned_end.isoformat(),
        expected_end_at=(planned_end + timedelta(hours=1)).isoformat(),
    )
    await machine_replans.advance()
    (task,) = tasks(fake_broker, "replan_for_machine")
    await handle(await publish_result(task, "ok", {"affected_order_ids": [], "plan_option_ids_by_order": {}}))
    assert await db_session.scalar(select(func.count()).select_from(Approval)) == 0
    kinds = set(await db_session.scalars(select(Notification.kind)))
    assert {"behind_schedule", "late_job_absorbed"} <= kinds
    assert await state(db_session, order) == "IN_PRODUCTION"


async def test_old_behind_schedule_event_only_notifies(db_session, fake_broker):
    order = await make_order(db_session, status="IN_PRODUCTION")
    db_session.add(WorkflowRun(order_id=order.id, state=order.status, attempts={}))
    await db_session.commit()
    await event("order.behind_schedule", order, minutes_behind=40)
    await machine_replans.advance()
    assert tasks(fake_broker, "replan_for_machine") == []
