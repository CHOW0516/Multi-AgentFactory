import asyncio

from app.agents.order.customer import close_order, draft_customer_reply
from app.agents.order.extraction import extract_document
from app.agents.order.mail import poll_periodically
from app.core.db import session_scope
from app.core.logging import setup_logging
from app.messaging import publish_result, run_consumer
from app.schemas.contracts import DraftCustomerReplyPayload, Empty, ExtractDocumentPayload, OrderRef
from app.schemas.envelope import Envelope


async def handle(task: Envelope) -> None:
    if task.action == "extract_document":
        payload = ExtractDocumentPayload.model_validate(task.payload)
        result = await extract_document(payload.document_id)
    elif task.action == "draft_customer_reply":
        payload = DraftCustomerReplyPayload.model_validate(task.payload)
        async with session_scope() as session:
            result = await draft_customer_reply(session, payload.order_id, payload.plan_option_id)
    elif task.action == "close_order":
        payload = OrderRef.model_validate(task.payload)
        async with session_scope() as session:
            await close_order(session, payload.order_id)
        result = Empty()
    else:
        raise ValueError(f"Unsupported order action: {task.action}")
    await publish_result(task, "ok", result)


async def main() -> None:
    async with asyncio.TaskGroup() as tasks:
        tasks.create_task(run_consumer("agent.order", handle))
        tasks.create_task(poll_periodically())


if __name__ == "__main__":
    setup_logging()
    asyncio.run(main())
