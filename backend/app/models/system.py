"""Workflow state, agent messages, notifications, settings, audit log."""

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import TableBase


class WorkflowRun(TableBase):
    __tablename__ = "workflow_runs"

    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    state: Mapped[str] = mapped_column(String(30), index=True)
    attempts: Mapped[dict] = mapped_column(JSONB, default=dict)  # {action: count}
    pending_message_id: Mapped[uuid.UUID | None] = mapped_column()
    last_error: Mapped[str | None] = mapped_column(Text)
    next_timeout_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)


class AgentMessage(TableBase):
    __tablename__ = "agent_messages"

    message_id: Mapped[uuid.UUID] = mapped_column(unique=True)
    correlation_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
    order_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
    message_type: Mapped[str] = mapped_column(String(10))  # task | result | event
    from_agent: Mapped[str] = mapped_column(String(30), index=True)
    to_agent: Mapped[str | None] = mapped_column(String(30), index=True)
    action: Mapped[str] = mapped_column(String(60))
    status: Mapped[str | None] = mapped_column(String(10))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    notes: Mapped[str | None] = mapped_column(Text)
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    in_reply_to: Mapped[uuid.UUID | None] = mapped_column()
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), default=0)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class ProcessedMessage(TableBase):
    """Idempotency: a consumer handles each message_id once."""

    __tablename__ = "processed_messages"
    __table_args__ = (UniqueConstraint("message_id", "consumer", name="message_consumer"),)

    message_id: Mapped[uuid.UUID] = mapped_column()
    consumer: Mapped[str] = mapped_column(String(60))


class LlmCall(TableBase):
    """One row per Claude call, for cost tracking and the daily limit."""

    __tablename__ = "llm_calls"

    purpose: Mapped[str] = mapped_column(String(20), index=True)  # orchestrator | extraction | explain
    model: Mapped[str] = mapped_column(String(60))
    order_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), default=0)
    stop_reason: Mapped[str | None] = mapped_column(String(30))


class Notification(TableBase):
    __tablename__ = "notifications"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str | None] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(String(300))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AppSetting(TableBase):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(80), unique=True)
    value: Mapped[str] = mapped_column(String(200))


class AuditLog(TableBase):
    __tablename__ = "audit_log"

    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), index=True)
    agent: Mapped[str | None] = mapped_column(String(30), index=True)
    action: Mapped[str] = mapped_column(String(80))
    entity: Mapped[str] = mapped_column(String(60), index=True)
    entity_id: Mapped[str | None] = mapped_column(String(60), index=True)
    before: Mapped[dict | None] = mapped_column(JSONB)
    after: Mapped[dict | None] = mapped_column(JSONB)
