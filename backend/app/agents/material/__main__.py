import asyncio
import logging

from app.agents.material import service
from app.core.db import session_scope
from app.core.logging import setup_logging
from app.messaging import publish_result, run_consumer
from app.schemas.contracts import Empty, OrderRef
from app.schemas.envelope import Envelope

logger = logging.getLogger(__name__)

ACTIONS = {
    "recheck_holds": service.recheck_holds,
    "confirm_holds": service.confirm_holds,
    "release_holds": service.release_holds,
    "create_purchase_requests": service.create_purchase_requests,
}


async def handle(task: Envelope) -> None:
    order_id = OrderRef.model_validate(task.payload).order_id
    async with session_scope() as session:
        if task.action == "check_and_hold":
            result = await service.check_and_hold(session, order_id, task.message_id)
        else:
            result = await ACTIONS[task.action](session, order_id)
    await publish_result(task, "ok", result if result is not None else Empty())


async def expire_periodically() -> None:
    while True:
        try:
            async with session_scope() as session:
                await service.expire_holds(session)
        except Exception:
            logger.exception("Could not expire temporary stock holds")
        await asyncio.sleep(60)


async def main() -> None:
    async with asyncio.TaskGroup() as tasks:
        tasks.create_task(run_consumer("agent.material", handle))
        tasks.create_task(expire_periodically())


if __name__ == "__main__":
    setup_logging()
    asyncio.run(main())
