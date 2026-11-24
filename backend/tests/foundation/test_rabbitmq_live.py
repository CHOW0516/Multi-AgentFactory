"""Round trip through a real RabbitMQ. Skipped when RABBITMQ_URL is not reachable."""

import asyncio
import socket
import uuid
from urllib.parse import urlparse

import pytest

from app.core.config import settings
from app.messaging import RabbitBroker, publish_task, run_consumer, set_broker


def rabbitmq_reachable() -> bool:
    parsed = urlparse(settings.rabbitmq_url)
    try:
        with socket.create_connection((parsed.hostname, parsed.port or 5672), timeout=1):
            return True
    except OSError:
        return False


@pytest.mark.skipif(not rabbitmq_reachable(), reason="RabbitMQ not reachable")
async def test_task_round_trip_through_rabbitmq():
    broker = RabbitBroker(settings.rabbitmq_url)
    set_broker(broker)
    received = asyncio.Queue()
    queue_name = f"agent.test{uuid.uuid4().hex[:6]}"

    async def handler(envelope):
        await received.put(envelope)

    agent_name = queue_name.removeprefix("agent.")
    consumer = asyncio.create_task(
        run_consumer(queue_name, handler, bindings=[f"task.{agent_name}", "task.material"])
    )
    try:
        await asyncio.sleep(0.5)
        order_id = uuid.uuid4()
        sent = await publish_task("material", "check_and_hold", order_id, {"order_id": str(order_id)})
        got = await asyncio.wait_for(received.get(), timeout=10)
        assert got.message_id == sent.message_id
    finally:
        consumer.cancel()
        channel = await broker.connection.channel()
        await channel.queue_delete(queue_name)
        await channel.queue_delete(f"{queue_name}.dlq")
        await broker.close()
