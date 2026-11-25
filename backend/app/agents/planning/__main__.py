import asyncio

from app.agents.planning import service
from app.core.db import session_scope
from app.core.logging import setup_logging
from app.messaging import publish_result, run_consumer
from app.schemas.contracts import (
    Empty,
    LockOrReleasePlanPayload,
    PlanOptionRef,
    PlanOrderPayload,
    ReplanForMachinePayload,
)
from app.schemas.envelope import Envelope


async def handle(task: Envelope) -> None:
    # AI wording is added after the planning transaction commits, so no AI call runs while
    # the schedule lock and a database connection are held.
    wording_jobs: list[service.WordingJob] = []
    async with session_scope() as session:
        if task.action == "plan_order":
            payload = PlanOrderPayload.model_validate(task.payload)
            result = await service.plan_order(
                session,
                payload.order_id,
                payload.material_ready_date,
                task.message_id,
                wording_jobs=wording_jobs,
            )
        elif task.action == "recheck_plan":
            payload = PlanOptionRef.model_validate(task.payload)
            result = await service.recheck_plan(session, payload.order_id, payload.plan_option_id)
        elif task.action == "lock_plan":
            payload = LockOrReleasePlanPayload.model_validate(task.payload)
            await service.lock_plan(session, payload.order_id, payload.plan_option_id)
            result = Empty()
        elif task.action == "release_plan":
            payload = LockOrReleasePlanPayload.model_validate(task.payload)
            await service.release_plan(session, payload.order_id, payload.plan_option_id)
            result = Empty()
        elif task.action == "replan_for_machine":
            payload = ReplanForMachinePayload.model_validate(task.payload)
            result = await service.replan_for_machine(
                session, payload, task.message_id, wording_jobs=wording_jobs
            )
        else:
            raise ValueError(f"Unsupported planning action: {task.action}")
    await service.add_wording(wording_jobs)
    await publish_result(task, "ok", result)


if __name__ == "__main__":
    setup_logging()
    asyncio.run(run_consumer("agent.planning", handle, prefetch=1))
