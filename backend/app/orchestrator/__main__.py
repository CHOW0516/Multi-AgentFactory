import asyncio
import logging

from app.core.logging import setup_logging
from app.messaging import RESULT_ROUTING_KEY, RESULTS_QUEUE, get_broker, run_consumer

from . import attention, machine_replans, workflow
from .outbox import drain_events

EVENTS = [
    "event.order.received",
    "event.order.fields_corrected",
    "event.order.revised",
    "event.machine.unavailable",
    "event.order.behind_schedule",
]
logger = logging.getLogger(__name__)


async def handle(message):
    if message.type == "event" and message.action == "event.machine.unavailable":
        await machine_replans.enqueue(message)
    elif message.type == "result" and message.order_id is None:
        await machine_replans.finish(message)
    else:
        await workflow.handle_order_message(message)


async def poll():
    while True:
        for operation in (
            workflow.tick,
            machine_replans.advance,
            attention.send_morning_briefing,
            drain_events,
        ):
            try:
                await operation()
            except Exception:
                logger.exception("Worker poll failed in %s", operation.__name__)
        await asyncio.sleep(1)


async def main():
    setup_logging()
    broker = get_broker()
    try:
        await broker.connect()
        await asyncio.gather(
            run_consumer(RESULTS_QUEUE, handle, [RESULT_ROUTING_KEY, *EVENTS], prefetch=1), poll()
        )
    finally:
        await broker.close()


if __name__ == "__main__":
    asyncio.run(main())
