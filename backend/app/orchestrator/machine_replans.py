"""Track machine-wide planning jobs, which have no order ID until the result."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select

from app.core.config import settings
from app.core.db import session_scope
from app.messaging import publish_task
from app.models import AgentMessage, AuditLog, Machine, MaintenanceEvent, WorkflowRun
from app.schemas.contracts import MachineUnavailable, ReplanForMachineResult

from .outbox import notify
from .workflow import create_approval, find_run, lock_order, roles, transition

ENTITY = "p3_machine_replan"


async def enqueue(message):
    data = MachineUnavailable.model_validate(message.payload)
    async with session_scope() as session:
        machine = await session.scalar(select(Machine).where(Machine.id == data.machine_id).with_for_update())
        if machine is None:
            return
        existing = await session.scalar(
            select(AuditLog.id).where(
                AuditLog.entity == ENTITY, AuditLog.entity_id == str(message.message_id)
            )
        )
        if existing is None:
            session.add(
                AuditLog(
                    agent="orchestrator",
                    action="pending",
                    entity=ENTITY,
                    entity_id=str(message.message_id),
                    after=data.model_dump(mode="json", by_alias=True),
                )
            )
            notify(
                session,
                await roles(session, "manager", "planner"),
                "machine_unavailable",
                f"{machine.code} is unavailable",
                data.reason,
                "/",
            )


async def queue_late_order(session, order, data, message_id):
    """A late running job keeps its machine busy longer. Replan like a short machine outage.

    Planning then only returns the orders that can no longer meet their due date, so the manager
    gets fix options instead of just a warning.
    """
    if data.machine_id is None or data.planned_end_at is None or data.expected_end_at is None:
        return
    if data.expected_end_at <= data.planned_end_at:
        return
    if await session.scalar(
        select(AuditLog.id).where(AuditLog.entity == ENTITY, AuditLog.entity_id == str(message_id))
    ):
        return
    machine = await session.get(Machine, data.machine_id)
    if machine is None:
        return
    hours = (data.expected_end_at - data.planned_end_at).total_seconds() / 3600
    session.add(
        AuditLog(
            agent="orchestrator",
            action="pending",
            entity=ENTITY,
            entity_id=str(message_id),
            after={
                "machine_id": str(machine.id),
                "from": data.planned_end_at.isoformat(),
                "to": data.expected_end_at.isoformat(),
                "reason": (
                    f"{order.order_number} is running late on {machine.code}. "
                    f"At the current pace its job ends about {hours:.1f} hours later than planned."
                ),
                "late_order_id": str(order.id),
            },
        )
    )


async def machine_back(session, data, now) -> bool:
    """A breakdown replan that is no longer needed: the machine runs and nothing blocks it now or later."""
    if data.get("late_order_id"):
        return False
    machine = await session.get(Machine, uuid.UUID(data["machine_id"]))
    if machine is None or machine.status in ("down", "maintenance"):
        return False
    blocking = await session.scalar(
        select(MaintenanceEvent.id)
        .where(
            MaintenanceEvent.machine_id == machine.id,
            or_(MaintenanceEvent.end_at.is_(None), MaintenanceEvent.end_at > now),
        )
        .limit(1)
    )
    return blocking is None


async def advance(now=None):
    now = now or datetime.now(UTC)
    async with session_scope() as session:
        identifiers = list(
            await session.scalars(
                select(AuditLog.id).where(
                    AuditLog.entity == ENTITY, AuditLog.action.in_(("pending", "applying"))
                )
            )
        )
    for identifier in identifiers:
        async with session_scope() as session:
            job = await session.get(AuditLog, identifier, with_for_update=True)
            if job.action == "applying":
                await apply_options(session, job)
                continue
            if job.action != "pending":
                continue
            previous = await session.scalar(
                select(AgentMessage)
                .where(AgentMessage.correlation_id == identifier, AgentMessage.message_type == "task")
                .order_by(AgentMessage.attempt.desc())
                .limit(1)
            )
            if previous and previous.sent_at + timedelta(seconds=settings.task_default_timeout_seconds) > now:
                continue
            if previous is None and await machine_back(session, job.after, now):
                job.action = "skipped"  # the machine is running again before the replan even started
                continue
            attempt = previous.attempt + 1 if previous else 1
            if attempt > settings.task_max_attempts:
                job.action = "failed"
                notify(
                    session,
                    await roles(session, "admin", "manager"),
                    "workflow_failed",
                    "Machine replan failed",
                    job.after["reason"],
                    "/",
                )
                continue
            data = job.after
            await publish_task(
                "planning",
                "replan_for_machine",
                None,
                dict(
                    machine_id=data["machine_id"],
                    unavailable_from=data["from"],
                    unavailable_to=data["to"],
                    late_order_id=data.get("late_order_id"),
                ),
                identifier,
                attempt=attempt,
            )


async def finish(message):
    if (
        message.from_agent != "planning"
        or message.action != "replan_for_machine"
        or not message.correlation_id
    ):
        return
    async with session_scope() as session:
        job = await session.get(AuditLog, message.correlation_id, with_for_update=True)
        if job is None or job.entity != ENTITY or job.action != "pending":
            return
        latest = await session.scalar(
            select(AgentMessage.message_id)
            .where(AgentMessage.correlation_id == job.id, AgentMessage.message_type == "task")
            .order_by(AgentMessage.attempt.desc())
            .limit(1)
        )
        if latest is None or message.in_reply_to != latest or message.status == "failed":
            return
        data = ReplanForMachineResult.model_validate(message.payload).model_dump(mode="json")
        options = {
            order_id: data["plan_option_ids_by_order"].get(order_id, [])
            for order_id in data["affected_order_ids"]
        }
        job.after = job.after | {"options": options}
        if job.after.get("late_order_id") and not options:
            notify(
                session,
                await roles(session, "manager", "planner"),
                "late_job_absorbed",
                "Late job: due dates still hold",
                job.after["reason"] + " Every affected order can still meet its due date.",
                f"/orders/{job.after['late_order_id']}",
            )
        await apply_options(session, job)


async def apply_options(session, job):
    deferred = {}
    for identifier, options in sorted(job.after["options"].items()):
        order = await lock_order(session, uuid.UUID(identifier))
        if order is None or order.status in (
            "FAILED",
            "DECLINED",
            "COMPLETED",
            "REJECTED",
            "CANCELLED",
            "WAITING_CUSTOMER",
            "SENDER_REVIEW",
        ):
            continue
        run = await find_run(session, order.id)
        if run is None:
            run = WorkflowRun(order_id=order.id, state=order.status, attempts={})
            session.add(run)
        if (run.attempts or {}).get("task"):
            deferred[identifier] = options
            continue
        changes = [job.after["reason"]]
        if not options:
            changes.append("Planning returned no replacement options for this order.")
        await transition(session, order, run, "REPLAN_NEEDED")
        await create_approval(session, order, run, options, "replan", changes)
    job.after = job.after | {"options": deferred}
    job.action = "applying" if deferred else "completed"
