"""The envelope every RabbitMQ message uses (contract section G)."""

import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

AgentName = Literal[
    "orchestrator",
    "order",
    "material",
    "planning",
    "quality",
    "monitoring",
    "maintenance",
    "simulator",
    "api",
]
MessageType = Literal["task", "result", "event"]
ResultStatus = Literal["ok", "partial", "failed"]


def utc_now() -> datetime:
    return datetime.now(UTC)


class Envelope(BaseModel):
    message_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    correlation_id: uuid.UUID | None = None
    order_id: uuid.UUID | None = None
    type: MessageType
    from_agent: AgentName
    to_agent: AgentName | None = None
    action: str
    payload: dict[str, Any] = Field(default_factory=dict)
    status: ResultStatus | None = None
    notes: str | None = None  # LLM free text, never used as data
    attempt: int = 1
    in_reply_to: uuid.UUID | None = None  # for results: the task's message_id
    reply_by: datetime | None = None
    sent_at: datetime = Field(default_factory=utc_now)
