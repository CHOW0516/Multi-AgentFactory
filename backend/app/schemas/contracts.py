"""Payload and result models for every agent action (contract section H) and event (events table).

`ACTIONS[(agent, action)] = (PayloadModel, ResultModel)` and `EVENTS[routing_key] = DataModel`
are used by app.messaging to validate messages on send and receive.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Empty(Contract):
    pass


class OrderRef(Contract):
    order_id: uuid.UUID


# ---- order agent ----
class ExtractDocumentPayload(Contract):
    document_id: uuid.UUID


class QuotationMismatch(Contract):
    field: str
    po_value: str | None
    quote_value: str | None


class ExtractDocumentResult(Contract):
    order_id: uuid.UUID
    fields_needing_check: list[str]
    quotation_mismatches: list[QuotationMismatch]


class DraftCustomerReplyPayload(Contract):
    order_id: uuid.UUID
    plan_option_id: uuid.UUID | None = None  # None for a decline


class DraftCustomerReplyResult(Contract):
    customer_message_id: uuid.UUID


# ---- material agent ----
class Shortage(Contract):
    material_id: uuid.UUID
    short_qty: Decimal
    arrives: date | None


class CheckAndHoldResult(Contract):
    material_ready_date: date | None  # None: a shortage has no known arrival date
    shortages: list[Shortage]
    hold_ids: list[uuid.UUID]
    hold_expires_at: datetime | None
    data_warnings: list[str]


class RecheckResult(Contract):
    valid: bool
    changes: list[str]


class CreatePurchaseRequestsResult(Contract):
    purchase_request_ids: list[uuid.UUID]


# ---- planning agent ----
class PlanOrderPayload(Contract):
    order_id: uuid.UUID
    material_ready_date: date | None  # None: material date unknown, so no promised option


class PlanOrderResult(Contract):
    plan_option_ids: list[uuid.UUID]
    recommended_option_id: uuid.UUID | None
    can_meet_due_date: bool


class PlanOptionRef(Contract):
    order_id: uuid.UUID
    plan_option_id: uuid.UUID


class LockOrReleasePlanPayload(Contract):
    order_id: uuid.UUID
    plan_option_id: uuid.UUID | None = None


class ReplanForMachinePayload(Contract):
    machine_id: uuid.UUID
    unavailable_from: datetime
    unavailable_to: datetime | None
    # Set when the machine is busy longer because this order's running job is late (not a breakdown).
    late_order_id: uuid.UUID | None = None


class ReplanForMachineResult(Contract):
    affected_order_ids: list[uuid.UUID]
    plan_option_ids_by_order: dict[str, list[uuid.UUID]]


# ---- quality agent ----
class CreateQcPlanResult(Contract):
    qc_plan_id: uuid.UUID


class VerifyCompletionResult(Contract):
    complete: bool
    missing: list[str]


ACTIONS: dict[tuple[str, str], tuple[type[Contract], type[Contract]]] = {
    ("order", "extract_document"): (ExtractDocumentPayload, ExtractDocumentResult),
    ("order", "draft_customer_reply"): (DraftCustomerReplyPayload, DraftCustomerReplyResult),
    ("order", "close_order"): (OrderRef, Empty),
    ("material", "check_and_hold"): (OrderRef, CheckAndHoldResult),
    ("material", "recheck_holds"): (OrderRef, RecheckResult),
    ("material", "confirm_holds"): (OrderRef, Empty),
    ("material", "release_holds"): (OrderRef, Empty),
    ("material", "create_purchase_requests"): (OrderRef, CreatePurchaseRequestsResult),
    ("planning", "plan_order"): (PlanOrderPayload, PlanOrderResult),
    ("planning", "recheck_plan"): (PlanOptionRef, RecheckResult),
    ("planning", "lock_plan"): (LockOrReleasePlanPayload, Empty),
    ("planning", "release_plan"): (LockOrReleasePlanPayload, Empty),
    ("planning", "replan_for_machine"): (ReplanForMachinePayload, ReplanForMachineResult),
    ("quality", "create_qc_plan"): (OrderRef, CreateQcPlanResult),
    ("quality", "verify_completion"): (OrderRef, VerifyCompletionResult),
}


# ---- events ----
class OrderReceived(Contract):
    order_id: uuid.UUID
    document_id: uuid.UUID


class OrderRevised(Contract):
    order_id: uuid.UUID
    previous_order_id: uuid.UUID


class MachineRaw(Contract):
    machine_id: uuid.UUID
    kind: Literal["status", "count", "power"]  # power: kW as a decimal string
    value: str
    at: datetime


class MachineStatusChanged(Contract):
    machine_id: uuid.UUID
    status: Literal["running", "idle", "setup", "down", "maintenance"]


class MachineUnavailable(Contract):
    """Wire field is "from" (a Python keyword), so it is aliased. Always dump with by_alias=True."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    machine_id: uuid.UUID
    from_: datetime = Field(alias="from")
    to: datetime | None
    reason: str


class OrderBehindSchedule(Contract):
    order_id: uuid.UUID
    minutes_behind: int
    # The machine running the late job and when that job should now finish at the current pace.
    machine_id: uuid.UUID | None = None
    planned_end_at: datetime | None = None
    expected_end_at: datetime | None = None


class OrderStateChanged(Contract):
    order_id: uuid.UUID
    from_state: str | None
    to_state: str


class ApprovalCreated(Contract):
    approval_id: uuid.UUID
    order_id: uuid.UUID
    approval_type: Literal["order", "replan"]


class NotificationEvent(Contract):
    user_ids: list[uuid.UUID]
    kind: str
    title: str
    body: str | None = None
    link: str | None = None


EVENTS: dict[str, type[Contract] | None] = {
    "event.order.received": OrderReceived,
    "event.order.fields_corrected": OrderRef,
    "event.order.revised": OrderRevised,
    "event.machine.raw": MachineRaw,
    "event.machine.status_changed": MachineStatusChanged,
    "event.machine.unavailable": MachineUnavailable,
    "event.order.behind_schedule": OrderBehindSchedule,
    "event.order.state_changed": OrderStateChanged,
    "event.approval.created": ApprovalCreated,
    "event.notification": NotificationEvent,
    "event.agent_message": None,  # the full envelope plus metrics; built by app.messaging
}
