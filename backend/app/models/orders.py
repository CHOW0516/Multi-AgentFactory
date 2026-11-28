"""Orders, PO documents, extraction, plans, approvals, customer messages, quality."""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Money, Quantity, TableBase

ORDER_STATES = (
    "RECEIVED",
    "EXTRACTED",
    "NEEDS_FIELD_CHECK",
    "VERIFIED",
    "MATERIAL_CHECKED",
    "PLANNED",
    "WAITING_APPROVAL",
    "RECHECKING",
    "CONFIRMED",
    "REPLY_DRAFTED",
    "CUSTOMER_REPLIED",
    "IN_PRODUCTION",
    "COMPLETED",
    "REJECTED",
    "DECLINED",
    "REPLAN_NEEDED",
    "FAILED",
    "WAITING_CUSTOMER",
    "CANCELLED",
    "SENDER_REVIEW",
)
# Orders in these states own no stock holds, purchase requests or future machine time.
CLOSED_ORDER_STATES = ("COMPLETED", "REJECTED", "DECLINED", "CANCELLED")
FINAL_ORDER_STATES = ("CUSTOMER_REPLIED", "COMPLETED", "DECLINED", "FAILED")


class SourceDocument(TableBase):
    __tablename__ = "source_documents"

    file_path: Mapped[str] = mapped_column(String(500))
    file_name: Mapped[str] = mapped_column(String(300))
    mime_type: Mapped[str] = mapped_column(String(120))
    email_message_id: Mapped[str | None] = mapped_column(String(300), index=True)
    email_from: Mapped[str | None] = mapped_column(String(300))
    email_subject: Mapped[str | None] = mapped_column(String(500))
    email_body: Mapped[str | None] = mapped_column(Text)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


class Order(TableBase):
    __tablename__ = "orders"

    order_number: Mapped[str] = mapped_column(String(30), unique=True)  # e.g. SO-2026-0412
    customer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("customers.id"), index=True)
    po_number: Mapped[str | None] = mapped_column(String(80), index=True)
    po_revision: Mapped[str | None] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(30), default="RECEIVED", index=True)
    priority: Mapped[int] = mapped_column(Integer, default=5)  # 1 = highest
    due_date: Mapped[date | None] = mapped_column(Date)
    promised_date: Mapped[date | None] = mapped_column(Date)
    delivery_address: Mapped[str | None] = mapped_column(String(500))
    notes: Mapped[str | None] = mapped_column(Text)
    source_document_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("source_documents.id"))
    quotation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("quotations.id"))
    previous_order_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("orders.id"))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class OrderLine(TableBase):
    __tablename__ = "order_lines"

    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    line_number: Mapped[int] = mapped_column(Integer)
    part_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("parts.id"))
    part_number_text: Mapped[str | None] = mapped_column(String(80))  # as written on the PO
    revision_text: Mapped[str | None] = mapped_column(String(20))
    quantity: Mapped[Decimal] = mapped_column(Quantity)
    unit_price: Mapped[Decimal | None] = mapped_column(Money)


class ExtractedField(TableBase):
    __tablename__ = "extracted_fields"

    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    field_name: Mapped[str] = mapped_column(String(80))  # e.g. "due_date", "lines[0].quantity"
    value: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[Decimal] = mapped_column(Numeric(4, 3))
    source_page: Mapped[int | None] = mapped_column(Integer)
    source_text: Mapped[str | None] = mapped_column(Text)
    needs_check: Mapped[bool] = mapped_column(Boolean, default=False)
    check_reason: Mapped[str | None] = mapped_column(String(200))
    corrected_value: Mapped[str | None] = mapped_column(Text)
    corrected_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


class ScheduleSlot(TableBase):
    __tablename__ = "schedule_slots"

    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    plan_option_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("plan_options.id", ondelete="CASCADE")
    )
    machine_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("machines.id"), index=True)
    routing_step: Mapped[int] = mapped_column(Integer)
    quantity: Mapped[Decimal] = mapped_column(Quantity)
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="tentative")  # tentative | locked | done
    is_overtime: Mapped[bool] = mapped_column(Boolean, default=False)


class PlanOption(TableBase):
    __tablename__ = "plan_options"

    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    option_type: Mapped[str] = mapped_column(
        String(30)
    )  # as_requested | delay | split | overtime | move_other_order | cheaper_energy
    finish_date: Mapped[date] = mapped_column(Date)
    split_quantity_first: Mapped[Decimal | None] = mapped_column(Quantity)
    split_finish_date_first: Mapped[date | None] = mapped_column(Date)
    overtime_hours: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0)
    extra_cost: Mapped[Decimal] = mapped_column(Money, default=0)
    # Electricity for this order's machine time; empty when energy is off or no machine has a kW value.
    energy_kwh: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    energy_cost: Mapped[Decimal | None] = mapped_column(Money)
    margin: Mapped[Decimal | None] = mapped_column(Money)
    machine_load: Mapped[dict | None] = mapped_column(JSONB)  # {machine_code: percent}
    impacted_orders: Mapped[list] = mapped_column(JSONB, default=list)
    explanation: Mapped[str | None] = mapped_column(Text)
    is_recommended: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(20), default="proposed")  # proposed | chosen | discarded


class Approval(TableBase):
    __tablename__ = "approvals"

    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    approval_type: Mapped[str] = mapped_column(String(20), default="order")  # order | replan
    status: Mapped[str] = mapped_column(
        String(20), default="waiting", index=True
    )  # waiting | decided | cancelled
    approver_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    decision: Mapped[str | None] = mapped_column(String(20))  # approve | reject | choose_option | question
    chosen_option_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("plan_options.id"))
    reject_reason: Mapped[str | None] = mapped_column(String(20))  # replan | counter_offer | decline
    comment: Mapped[str | None] = mapped_column(Text)
    what_changed: Mapped[list | None] = mapped_column(JSONB)
    reminded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    escalated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CustomerMessage(TableBase):
    __tablename__ = "customer_messages"

    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    plan_option_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("plan_options.id"))
    subject: Mapped[str] = mapped_column(String(300))
    draft_text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft | sent_by_sales
    sent_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class QcPlan(TableBase):
    __tablename__ = "qc_plans"

    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    checks: Mapped[list] = mapped_column(JSONB, default=list)  # [{name, kind, every_n, spec}]


class QcRecord(TableBase):
    __tablename__ = "qc_records"

    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    qc_plan_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("qc_plans.id", ondelete="CASCADE"))
    check_name: Mapped[str] = mapped_column(String(120))
    result: Mapped[str] = mapped_column(String(10))  # pass | fail
    measured_value: Mapped[str | None] = mapped_column(String(120))
    inspector_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str | None] = mapped_column(Text)
