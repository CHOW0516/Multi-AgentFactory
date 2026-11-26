"""State transitions are persisted before the worker dispatches the next task."""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi.encoders import jsonable_encoder
from sqlalchemy import select

from app.api.settings import effective_settings
from app.core.audit import write_audit
from app.core.config import settings
from app.core.db import session_scope
from app.messaging import publish_task
from app.models import (
    CLOSED_ORDER_STATES,
    AgentMessage,
    Approval,
    MachineEvent,
    Order,
    ScheduleSlot,
    User,
    WorkflowRun,
)
from app.schemas.contracts import ACTIONS, EVENTS

from .cleanup import release_order_resources
from .outbox import emit, notify

# Orders that are being made or are finished. A revised or duplicate PO never releases these
# automatically; sales and the manager decide.
PRODUCTION_STATES = ("IN_PRODUCTION", "COMPLETED")

# How long each task may take before the orchestrator gives up and sends it again.
# A retry while the first attempt still runs wastes AI calls, so these are generous.
TASK_TIMEOUT_SECONDS = {
    "extract_document": 300,
    "plan_order": 240,
    "replan_for_machine": 600,
    "draft_customer_reply": 180,
}


def task_timeout(action):
    return max(TASK_TIMEOUT_SECONDS.get(action, 0), settings.task_default_timeout_seconds)


async def roles(session, *names):
    return list(
        await session.scalars(select(User).where(User.role.in_(names), User.is_active).order_by(User.id))
    )


async def lock_order(session, order_id):
    return await session.scalar(select(Order).where(Order.id == order_id).with_for_update())


async def find_run(session, order_id):
    return await session.scalar(select(WorkflowRun).where(WorkflowRun.order_id == order_id))


async def transition(session, order, run, state):
    previous = run.state
    if previous == state:
        return
    order.status = run.state = state
    audit = await write_audit(
        session, "orchestrator", "state_changed", "order", order.id, {"state": previous}, {"state": state}
    )
    audit.created_at = datetime.now(UTC)
    emit(session, "event.order.state_changed", dict(order_id=order.id, from_state=previous, to_state=state))
    if state in CLOSED_ORDER_STATES:
        await release_order_resources(session, order.id, state)


def update(run, **values):
    run.attempts = (run.attempts or {}) | jsonable_encoder(values)


def schedule(run, agent, action, **payload):
    update(run, task=dict(agent=agent, action=action, payload=payload, attempt=1, key=uuid.uuid4()))
    run.pending_message_id = None
    run.next_timeout_at = None


def clear(run):
    update(run, task=None)
    run.pending_message_id = None
    run.next_timeout_at = None


def order_task(run, agent, action, **payload):
    schedule(run, agent, action, order_id=run.order_id, **payload)


async def start(session, order, document_id):
    if await find_run(session, order.id) or not document_id:
        return
    run = WorkflowRun(order_id=order.id, state="RECEIVED", attempts={})
    session.add(run)
    order.status = "RECEIVED"
    audit = await write_audit(
        session, "orchestrator", "state_changed", "order", order.id, after={"state": "RECEIVED"}
    )
    audit.created_at = datetime.now(UTC)
    emit(session, "event.order.state_changed", dict(order_id=order.id, from_state=None, to_state="RECEIVED"))
    schedule(run, "order", "extract_document", document_id=document_id)


async def check_material(session, order, run, state="VERIFIED"):
    await transition(session, order, run, state)
    order_task(run, "material", "check_and_hold")


async def cancel_approval(session, order_id):
    rows = await session.scalars(
        select(Approval).where(Approval.order_id == order_id, Approval.status == "waiting")
    )
    for row in rows:
        row.status = "cancelled"


async def create_approval(session, order, run, option_ids, approval_type="order", changes=None):
    await cancel_approval(session, order.id)
    managers = await roles(session, "manager")
    row = Approval(
        order_id=order.id,
        approval_type=approval_type,
        what_changed=changes,
        approver_id=managers[0].id if managers else None,
    )
    session.add(row)
    await session.flush()
    update(run, approval_id=row.id, option_ids=option_ids, recheck_changes=[])
    await transition(session, order, run, "WAITING_APPROVAL")
    emit(
        session,
        "event.approval.created",
        dict(approval_id=row.id, order_id=order.id, approval_type=approval_type),
    )
    notify(
        session, managers, "approval_created", f"Approval needed for {order.order_number}", link="/approvals"
    )


async def release(session, order, run, purpose):
    await cancel_approval(session, order.id)
    await transition(session, order, run, "DECLINED" if purpose == "decline" else "REPLAN_NEEDED")
    update(run, release_purpose=purpose)
    order_task(run, "material", "release_holds")


async def fail(session, order, run, error):
    # Keep the failed task so a manager can retry it. Holds and slots stay until a retry or cancel.
    update(run, failed_task=run.attempts.get("task"), failed_from=run.state)
    clear(run)
    run.last_error = error
    await transition(session, order, run, "FAILED")
    notify(
        session,
        await roles(session, "admin", "manager"),
        "workflow_failed",
        f"Workflow failed for {order.order_number}",
        error,
        f"/orders/{order.id}",
    )


async def cancel(session, order, run, reason):
    """Stop the order and free its holds, machine time and draft purchase requests."""
    await cancel_approval(session, order.id)
    clear(run)
    update(run, cancel_reason=reason)
    await transition(session, order, run, "CANCELLED")
    notify(
        session,
        await roles(session, "sales", "manager", "planner"),
        "order_cancelled",
        f"{order.order_number} was cancelled",
        reason,
        f"/orders/{order.id}",
    )


async def retry_failed(session, order, run):
    """Send the task that failed again, from the state the order was in."""
    task = (run.attempts or {}).get("failed_task")
    if run.state != "FAILED" or not task:
        raise ValueError("Only a failed order with a recorded task can be retried")
    run.last_error = None
    await transition(session, order, run, run.attempts.get("failed_from") or "RECEIVED")
    update(run, failed_task=None, failed_from=None)
    schedule(run, task["agent"], task["action"], **task["payload"])


async def customer_answer(session, order, run, accepted, comment=None):
    """The customer answered a counter-offer. Accepted: confirm the offered plan. Rejected: cancel."""
    if run.state != "WAITING_CUSTOMER":
        raise ValueError("This order is not waiting for a customer answer")
    update(run, counter_offer=False)
    if accepted:
        await transition(session, order, run, "RECHECKING")
        order_task(run, "material", "recheck_holds")
    else:
        await cancel(session, order, run, comment or "The customer rejected the counter-offer.")


async def apply_decision(session, order, run, approval):
    update(
        run,
        selected_option=approval.chosen_option_id,
        recheck_changes=[],
        recheck_invalid=False,
        approval_type=approval.approval_type,
    )
    if approval.decision in ("approve", "choose_option"):
        await transition(session, order, run, "RECHECKING")
        order_task(run, "material", "recheck_holds")
    elif approval.reject_reason == "counter_offer":
        # The plan is locked only after the customer accepts the new date (customer_answer).
        update(run, counter_offer=True)
        order_task(run, "order", "draft_customer_reply", plan_option_id=approval.chosen_option_id)
    else:
        update(run, changes=[approval.comment or "Manager requested a new plan."])
        await release(session, order, run, approval.reject_reason)


async def apply_result(session, order, run, action, data):
    meta = run.attempts
    selected = meta.get("selected_option")
    if action == "extract_document":
        if data["order_id"] != str(order.id):
            raise ValueError("Extraction result references a different order")
        await transition(session, order, run, "EXTRACTED")
        if data["fields_needing_check"] or data["quotation_mismatches"]:
            await transition(session, order, run, "NEEDS_FIELD_CHECK")
            notify(
                session,
                await roles(session, "sales"),
                "field_check",
                f"Review fields for {order.order_number}",
                link=f"/orders/{order.id}",
            )
        else:
            await check_material(session, order, run)
    elif action == "check_and_hold":
        await transition(session, order, run, "MATERIAL_CHECKED")
        order_task(run, "planning", "plan_order", material_ready_date=data["material_ready_date"])
    elif action == "plan_order":
        await transition(session, order, run, "PLANNED")
        await create_approval(
            session,
            order,
            run,
            data["plan_option_ids"],
            meta.get("approval_type", "order"),
            meta.get("changes"),
        )
    elif action in ("recheck_holds", "recheck_plan"):
        changes = meta.get("recheck_changes", []) + data["changes"]
        invalid = meta.get("recheck_invalid", False) or not data["valid"]
        if action == "recheck_holds":
            update(run, recheck_changes=changes, recheck_invalid=invalid)
            order_task(run, "planning", "recheck_plan", plan_option_id=selected)
        elif invalid:
            update(run, changes=changes or ["The material hold or schedule is no longer valid."])
            await release(session, order, run, "replan")
        else:
            order_task(run, "material", "confirm_holds")
    elif action == "confirm_holds":
        order_task(run, "planning", "lock_plan", plan_option_id=selected)
    elif action == "lock_plan":
        order_task(run, "material", "create_purchase_requests")
    elif action == "create_purchase_requests":
        await transition(session, order, run, "CONFIRMED")
        order_task(run, "quality", "create_qc_plan")
    elif action == "create_qc_plan":
        order_task(run, "order", "draft_customer_reply", plan_option_id=selected)
    elif action == "draft_customer_reply":
        if meta.get("counter_offer"):
            await transition(session, order, run, "WAITING_CUSTOMER")
        elif run.state != "DECLINED":
            await transition(session, order, run, "REPLY_DRAFTED")
        notify(
            session,
            await roles(session, "sales"),
            "reply_drafted",
            f"Reply ready for {order.order_number}",
            link=f"/orders/{order.id}",
        )
    elif action == "release_holds":
        order_task(run, "planning", "release_plan")
    elif action == "release_plan":
        purpose = meta["release_purpose"]
        if purpose == "replan":
            await check_material(session, order, run, "REPLAN_NEEDED")
        elif purpose == "decline":
            order_task(run, "order", "draft_customer_reply", plan_option_id=None)
        else:
            await transition(session, order, run, "REJECTED")
            replacement = await lock_order(session, uuid.UUID(meta["replacement_order_id"]))
            if replacement:
                await start(session, replacement, replacement.source_document_id)
    elif action == "verify_completion":
        if data["complete"]:
            order_task(run, "order", "close_order")
        else:
            if meta.get("qc_missing") != data["missing"]:
                update(run, qc_missing=data["missing"])
                notify(
                    session,
                    await roles(session, "qc"),
                    "qc_incomplete",
                    f"QC checks pending for {order.order_number}",
                    link=f"/orders/{order.id}",
                )
            update(run, qc_retry_after=datetime.now(UTC) + timedelta(minutes=1))
    elif action == "close_order":
        order.completed_at = order.completed_at or datetime.now(UTC)
        await transition(session, order, run, "COMPLETED")


def retry(run):
    task = run.attempts["task"]
    if task["attempt"] >= settings.task_max_attempts:
        return False
    update(run, task=task | {"attempt": task["attempt"] + 1, "key": uuid.uuid4()})
    run.pending_message_id = run.next_timeout_at = None
    return True


async def dispatch(session, order, run, now):
    if run.next_timeout_at and run.next_timeout_at <= now:
        if not retry(run):
            await fail(session, order, run, f"{run.attempts['task']['action']} timed out")
            return
    task = run.attempts.get("task")
    if not task or run.pending_message_id:
        return
    key = uuid.UUID(task["key"])
    # The shared publisher writes its message log before sending. Recover that identity if
    # the broker accepted the task but the workflow did not commit the pending ID.
    previous = await session.scalar(
        select(AgentMessage).where(AgentMessage.correlation_id == key, AgentMessage.message_type == "task")
    )
    if previous:
        run.pending_message_id = previous.message_id
        run.next_timeout_at = previous.sent_at + timedelta(seconds=task_timeout(task["action"]))
        return
    sent = await publish_task(
        task["agent"],
        task["action"],
        order.id,
        task["payload"],
        key,
        attempt=task["attempt"],
        timeout_seconds=task_timeout(task["action"]),
    )
    run.pending_message_id, run.next_timeout_at = sent.message_id, sent.reply_by


async def handle_order_message(message):
    if message.type == "event":
        schema = EVENTS.get(message.action)
        if schema is None:
            return
        data = schema.model_validate(message.payload)
        order_id = data.order_id
    else:
        order_id = message.order_id
    async with session_scope() as session:
        if message.action == "event.order.revised" and message.type == "event":
            previous = await lock_order(session, data.previous_order_id)
            if previous and previous.status not in PRODUCTION_STATES + CLOSED_ORDER_STATES:
                run = await find_run(session, previous.id)
                if run is None:
                    run = WorkflowRun(order_id=previous.id, state=previous.status, attempts={})
                    session.add(run)
                if (run.attempts or {}).get("replacement_order_id") != str(order_id):
                    update(run, replacement_order_id=order_id)
                    await release(session, previous, run, "revision")
                return
        order = await lock_order(session, order_id)
        if order is None:
            return
        run = await find_run(session, order.id)
        if message.action == "event.order.received":
            if order.previous_order_id:
                previous_run = await find_run(session, order.previous_order_id)
                if previous_run is None or previous_run.state != "REJECTED":
                    return
            await start(session, order, data.document_id)
        elif run is None:
            return
        elif message.action == "event.order.fields_corrected" and run.state == "NEEDS_FIELD_CHECK":
            await check_material(session, order, run)
        elif message.action == "event.order.behind_schedule":
            if (run.attempts or {}).get("last_delay_event") != str(message.message_id):
                update(run, last_delay_event=message.message_id)
                notify(
                    session,
                    await roles(session, "manager", "planner"),
                    "behind_schedule",
                    f"{order.order_number} is behind schedule",
                    f"Estimated delay is {data.minutes_behind} minutes.",
                    f"/orders/{order.id}",
                )
        elif message.type == "result":
            task = (run.attempts or {}).get("task")
            if not task or not message.in_reply_to:
                return
            if (task["agent"], task["action"], task["key"]) != (
                message.from_agent,
                message.action,
                str(message.correlation_id),
            ):
                return
            if message.in_reply_to != run.pending_message_id:
                if run.pending_message_id is not None:
                    return
                recorded = await session.scalar(
                    select(AgentMessage.id).where(
                        AgentMessage.message_id == message.in_reply_to,
                        AgentMessage.correlation_id == message.correlation_id,
                        AgentMessage.message_type == "task",
                    )
                )
                if recorded is None:
                    return
            if message.status == "failed":
                if (message.payload or {}).get("retryable") is False:
                    # The agent already knows a retry cannot succeed (bad data, not a network error).
                    error = message.payload.get("error") or "permanent error"
                    await fail(session, order, run, f"{message.action} failed: {error}")
                elif not retry(run):
                    await fail(
                        session, order, run, f"{message.action} failed after {task['attempt']} attempts"
                    )
                return
            result = ACTIONS[task["agent"], task["action"]][1].model_validate(message.payload)
            clear(run)
            await apply_result(session, order, run, message.action, result.model_dump(mode="json"))


async def reminders(session, approval, order, now):
    thresholds = await effective_settings(session)
    elapsed = now - approval.created_at
    primary = await session.get(User, approval.approver_id) if approval.approver_id else None
    if not approval.reminded_at and elapsed >= timedelta(hours=thresholds["approval_reminder_hours"]):
        approval.reminded_at = now
        recipients = [primary] if primary and primary.is_active else await roles(session, "manager")
        notify(
            session,
            recipients,
            "approval_reminder",
            f"Approval pending for {order.order_number}",
            link="/approvals",
        )
    if not approval.escalated_at and elapsed >= timedelta(hours=thresholds["approval_escalation_hours"]):
        backup = (
            await session.get(User, primary.backup_approver_id)
            if primary and primary.backup_approver_id
            else None
        )
        if backup and backup.is_active and backup.id != primary.id:
            approval.escalated_at = now
            notify(
                session,
                [backup],
                "approval_escalated",
                f"Backup approval needed for {order.order_number}",
                link="/approvals",
            )


async def production_progress(session, order, run, now):
    if order.status == "CUSTOMER_REPLIED" and run.state == "REPLY_DRAFTED":
        await transition(session, order, run, "CUSTOMER_REPLIED")
    slots = list(
        await session.scalars(
            select(ScheduleSlot)
            .where(ScheduleSlot.order_id == order.id, ScheduleSlot.status.in_(("locked", "done")))
            .order_by(ScheduleSlot.start_at)
        )
    )
    started = order.status == "IN_PRODUCTION"
    finished = bool(slots)
    for slot in slots:
        if slot.status == "done":
            started = True
            continue
        next_slot = await session.scalar(
            select(ScheduleSlot.start_at)
            .where(
                ScheduleSlot.machine_id == slot.machine_id,
                ScheduleSlot.start_at > slot.start_at,
                ScheduleSlot.status.in_(("locked", "done")),
            )
            .order_by(ScheduleSlot.start_at)
            .limit(1)
        )
        filters = (
            MachineEvent.machine_id == slot.machine_id,
            MachineEvent.order_id == order.id,
            MachineEvent.event_type == "count",
            MachineEvent.happened_at >= slot.start_at,
        )
        if next_slot:
            filters = (*filters, MachineEvent.happened_at < next_slot)
        reported = await session.scalar(
            select(MachineEvent.value).where(*filters).order_by(MachineEvent.happened_at.desc()).limit(1)
        )
        started |= reported is not None
        finished &= reported is not None and int(reported) >= slot.quantity
    if started:
        await transition(session, order, run, "IN_PRODUCTION")
    retry_after = run.attempts.get("qc_retry_after")
    if finished and (not retry_after or datetime.fromisoformat(retry_after) <= now):
        order_task(run, "quality", "verify_completion")


async def tick(now=None):
    now = now or datetime.now(UTC)
    async with session_scope() as session:
        run_ids = list(
            await session.scalars(
                select(WorkflowRun.order_id).where(
                    WorkflowRun.attempts["task"].as_string().is_not(None)
                    | WorkflowRun.state.in_(
                        ("WAITING_APPROVAL", "REPLY_DRAFTED", "CUSTOMER_REPLIED", "IN_PRODUCTION")
                    )
                )
            )
        )
    for order_id in run_ids:
        async with session_scope() as session:
            order = await lock_order(session, order_id)
            if order is None:
                continue
            run = await find_run(session, order_id)
            if run is None:
                continue
            if (run.attempts or {}).get("task"):
                await dispatch(session, order, run, now)
            elif run.state == "WAITING_APPROVAL":
                identifier = (run.attempts or {}).get("approval_id")
                approval = await session.get(Approval, uuid.UUID(identifier)) if identifier else None
                if approval and approval.status == "waiting":
                    await reminders(session, approval, order, now)
            elif run.state in ("REPLY_DRAFTED", "CUSTOMER_REPLIED", "IN_PRODUCTION"):
                await production_progress(session, order, run, now)
