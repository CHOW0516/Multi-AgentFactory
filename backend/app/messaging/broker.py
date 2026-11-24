"""Brokers: RabbitBroker (aio-pika) for real use, InMemoryBroker for tests.

Topology (exchange "factory", type topic):
  task.<agent>          -> queue agent.<agent>
  result.orchestrator   -> queue orchestrator.results
  event.*               -> any queue that binds to it
Every queue gets a dead-letter queue "<queue>.dlq" through exchange "factory.dlx".
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

import aio_pika
from aio_pika.abc import AbstractChannel, AbstractExchange, AbstractIncomingMessage, AbstractRobustConnection

logger = logging.getLogger(__name__)

EXCHANGE_NAME = "factory"
DEAD_LETTER_EXCHANGE_NAME = "factory.dlx"


@dataclass
class Delivery:
    """A received message, independent of the broker."""

    routing_key: str
    body: bytes
    headers: dict = field(default_factory=dict)


# Returns True when the message is finished (ack), False to dead-letter it.
DeliveryHandler = Callable[[Delivery], Awaitable[bool]]


def topic_matches(pattern: str, routing_key: str) -> bool:
    """AMQP topic matching: '*' is one word, '#' is zero or more words."""
    pattern_words = pattern.split(".")
    key_words = routing_key.split(".")

    def match(pattern_index: int, key_index: int) -> bool:
        if pattern_index == len(pattern_words):
            return key_index == len(key_words)
        word = pattern_words[pattern_index]
        if word == "#":
            return any(
                match(pattern_index + 1, next_key) for next_key in range(key_index, len(key_words) + 1)
            )
        if key_index == len(key_words):
            return False
        if word == "*" or word == key_words[key_index]:
            return match(pattern_index + 1, key_index + 1)
        return False

    return match(0, 0)


class RabbitBroker:
    def __init__(self, url: str):
        self.url = url
        self.connection: AbstractRobustConnection | None = None
        self.channel: AbstractChannel | None = None
        self.exchange: AbstractExchange | None = None
        self.dead_letter_exchange: AbstractExchange | None = None

    async def connect(self) -> None:
        if self.connection is not None:
            return
        self.connection = await aio_pika.connect_robust(self.url)
        self.channel = await self.connection.channel()
        self.exchange = await self.channel.declare_exchange(
            EXCHANGE_NAME, aio_pika.ExchangeType.TOPIC, durable=True
        )
        self.dead_letter_exchange = await self.channel.declare_exchange(
            DEAD_LETTER_EXCHANGE_NAME, aio_pika.ExchangeType.DIRECT, durable=True
        )

    async def close(self) -> None:
        if self.connection is not None:
            await self.connection.close()
        self.connection = self.channel = self.exchange = self.dead_letter_exchange = None

    async def declare_queue(self, queue_name: str, bindings: list[str], prefetch: int = 10):
        await self.connect()
        dead_letter_queue = await self.channel.declare_queue(f"{queue_name}.dlq", durable=True)
        await dead_letter_queue.bind(self.dead_letter_exchange, routing_key=queue_name)
        queue = await self.channel.declare_queue(
            queue_name,
            durable=True,
            arguments={
                "x-dead-letter-exchange": DEAD_LETTER_EXCHANGE_NAME,
                "x-dead-letter-routing-key": queue_name,
            },
        )
        for binding in bindings:
            await queue.bind(self.exchange, routing_key=binding)
        return queue

    async def publish(self, routing_key: str, body: bytes, headers: dict | None = None) -> None:
        await self.connect()
        message = aio_pika.Message(
            body=body,
            headers=headers or {},
            content_type="application/json",
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
        )
        await self.exchange.publish(message, routing_key=routing_key)

    async def consume(
        self, queue_name: str, bindings: list[str], handler: DeliveryHandler, prefetch: int = 10
    ) -> None:
        """Consume forever. prefetch=1 gives one-at-a-time processing (used by the Planning agent)."""
        await self.connect()
        consumer_channel = await self.connection.channel()
        await consumer_channel.set_qos(prefetch_count=prefetch)
        await self.declare_queue(queue_name, bindings)
        queue = await consumer_channel.get_queue(queue_name)

        async def on_message(message: AbstractIncomingMessage) -> None:
            delivery = Delivery(message.routing_key or "", message.body, dict(message.headers or {}))
            try:
                finished = await handler(delivery)
            except Exception:
                logger.exception("Unhandled error in consumer %s", queue_name)
                finished = False
            if finished:
                await message.ack()
            else:
                await message.reject(requeue=False)  # goes to <queue>.dlq

        await queue.consume(on_message)
        await asyncio.Future()  # run until cancelled


class InMemoryBroker:
    """Test broker. Records every publish; delivers to registered consumers when `deliver` is True."""

    def __init__(self, deliver: bool = False):
        self.deliver = deliver
        self.published: list[Delivery] = []
        self.dead_letters: list[tuple[str, Delivery]] = []
        self.consumers: list[tuple[str, list[str], DeliveryHandler]] = []

    async def connect(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def declare_queue(self, queue_name: str, bindings: list[str], prefetch: int = 10) -> None:
        return None

    async def publish(self, routing_key: str, body: bytes, headers: dict | None = None) -> None:
        delivery = Delivery(routing_key, body, dict(headers or {}))
        self.published.append(delivery)
        if not self.deliver:
            return
        for queue_name, bindings, handler in list(self.consumers):
            if any(topic_matches(binding, routing_key) for binding in bindings):
                finished = await handler(delivery)
                if not finished:
                    self.dead_letters.append((queue_name, delivery))

    async def consume(
        self, queue_name: str, bindings: list[str], handler: DeliveryHandler, prefetch: int = 10
    ) -> None:
        self.consumers.append((queue_name, bindings, handler))

    def published_to(self, routing_key_pattern: str) -> list[Delivery]:
        return [item for item in self.published if topic_matches(routing_key_pattern, item.routing_key)]
