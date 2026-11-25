"""Track machine-wide planning jobs, which have no order ID until the result."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.core.config import settings
from app.core.db import session_scope
from app.messaging import publish_task
from app.models import AgentMessage, AuditLog, Machine, WorkflowRun
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
                "/factory-floor",
            )


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
            attempt = previous.attempt + 1 if previous else 1
            if attempt > settings.task_max_attempts:
                job.action = "failed"
                notify(
                    session,
                    await roles(session, "admin", "manager"),
                    "workflow_failed",
                    "Machine replan failed",
                    job.after["reason"],
                    "/factory-floor",
                )
                continue
            data = job.after
            await publish_task(
                "planning",
                "replan_for_machine",
                None,
                dict(machine_id=data["machine_id"], unavailable_from=data["from"], unavailable_to=data["to"]),
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
        await apply_options(session, job)


async def apply_options(session, job):
    deferred = {}
    for identifier, options in sorted(job.after["options"].items()):
        order = await lock_order(session, uuid.UUID(identifier))
        if order is None or order.status in ("FAILED", "DECLINED", "COMPLETED", "REJECTED"):
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
