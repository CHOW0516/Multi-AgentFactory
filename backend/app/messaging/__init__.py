"""Shared messaging library (contract section D). Import from here."""

from app.messaging.broker import Delivery, InMemoryBroker, RabbitBroker, topic_matches
from app.messaging.core import (
    AGENT_MESSAGE_EVENT,
    RESULT_ROUTING_KEY,
    RESULTS_QUEUE,
    ContractError,
    agent_queue,
    get_broker,
    make_delivery_handler,
    publish_event,
    publish_result,
    publish_task,
    run_consumer,
    set_broker,
    task_routing_key,
)

__all__ = [
    "Delivery",
    "InMemoryBroker",
    "RabbitBroker",
    "topic_matches",
    "AGENT_MESSAGE_EVENT",
    "RESULT_ROUTING_KEY",
    "RESULTS_QUEUE",
    "ContractError",
    "agent_queue",
    "get_broker",
    "make_delivery_handler",
    "publish_event",
    "publish_result",
    "publish_task",
    "run_consumer",
    "set_broker",
    "task_routing_key",
]
