import asyncio

from app.core.db import session_scope
from app.messaging import publish_result, run_consumer
from app.schemas.contracts import OrderRef

from . import create_plan, verify


async def handle(task):
    order_id = OrderRef.model_validate(task.payload).order_id
    async with session_scope() as session:
        if task.action == "create_qc_plan":
            plan = await create_plan(session, order_id)
            data = {"qc_plan_id": plan.id}
        else:
            missing = await verify(session, order_id)
            data = {"complete": not missing, "missing": missing}
    await publish_result(task, "ok", data)


if __name__ == "__main__":
    asyncio.run(run_consumer("agent.quality", handle, prefetch=1))
