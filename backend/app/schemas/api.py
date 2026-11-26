"""Response models for the REST API (contract section I).

Owners of each endpoint return these shapes. The desktop mirrors them in desktop/src/api/types.ts.
Add a model here by request to P1 (docs/requests/<id>.md); do not define a different shape locally.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.floor import LayoutOut

Role = Literal["manager", "sales", "planner", "store", "qc", "admin"]
MachineStatus = Literal["running", "idle", "setup", "down", "maintenance"]


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page[ItemT](ApiModel):
    items: list[ItemT]
    total: int
    page: int
    page_size: int


# ---- auth / users (P1) ----
class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(ApiModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


class UserOut(ApiModel):
    id: uuid.UUID
    name: str
    email: str
    role: Role
    backup_approver_id: uuid.UUID | None
    is_active: bool


class UserCreate(BaseModel):
    name: str
    email: str
    role: Role
    password: str
    backup_approver_id: uuid.UUID | None = None


class UserUpdate(BaseModel):
    name: str | None = None
    role: Role | None = None
    password: str | None = None
    backup_approver_id: uuid.UUID | None = None
    is_active: bool | None = None


# ---- master data (P1) ----
class CustomerOut(ApiModel):
    id: uuid.UUID
    code: str
    name: str
    email: str | None
    address: str | None


class CustomerIn(BaseModel):
    code: str
    name: str
    email: str | None = None
    address: str | None = None


class PartOut(ApiModel):
    id: uuid.UUID
    part_number: str
    revision: str
    description: str | None
    customer_id: uuid.UUID | None
    qc_sample_every: int
    qc_notes: str | None


class PartIn(BaseModel):
    part_number: str
    revision: str
    description: str | None = None
    customer_id: uuid.UUID | None = None
    qc_sample_every: int = 50
    qc_notes: str | None = None


class BomLineOut(ApiModel):
    id: uuid.UUID
    material_id: uuid.UUID
    quantity_per_part: Decimal
    scrap_rate: Decimal


class BomLineIn(BaseModel):
    material_id: uuid.UUID
    quantity_per_part: Decimal
    scrap_rate: Decimal = Decimal("0")


class RoutingStepOut(ApiModel):
    id: uuid.UUID
    step_number: int
    machine_type: str
    setup_minutes: int
    cycle_seconds_per_part: Decimal


class RoutingStepIn(BaseModel):
    step_number: int
    machine_type: str
    setup_minutes: int = 0
    cycle_seconds_per_part: Decimal


class SupplierOut(ApiModel):
    id: uuid.UUID
    name: str
    email: str | None


class SupplierIn(BaseModel):
    name: str
    email: str | None = None


class MachineOut(ApiModel):
    id: uuid.UUID
    code: str
    name: str
    machine_type: str
    status: MachineStatus
    floor_x: int
    floor_y: int


class MachineIn(BaseModel):
    code: str
    name: str
    machine_type: str
    floor_x: int = 0
    floor_y: int = 0


class MachinePatch(BaseModel):
    name: str | None = None
    machine_type: str | None = None
    floor_x: int | None = None
    floor_y: int | None = None


class ShiftOut(ApiModel):
    id: uuid.UUID
    name: str
    weekday: int
    start_time: str
    end_time: str


class ShiftIn(BaseModel):
    name: str
    weekday: int
    start_time: str  # "HH:MM"
    end_time: str


class HolidayOut(ApiModel):
    id: uuid.UUID
    holiday_date: date
    name: str


class HolidayIn(BaseModel):
    holiday_date: date
    name: str


class SettingsOut(ApiModel):
    app_mode: str
    currency: str
    timezone: str
    values: dict[str, float]


class SettingsPatch(BaseModel):
    values: dict[str, float]


class HealthOut(ApiModel):
    status: Literal["ok", "degraded"]
    database: bool
    app_mode: str


# ---- orders (P2) ----
class OrderLineOut(ApiModel):
    id: uuid.UUID
    line_number: int
    part_id: uuid.UUID | None
    part_number_text: str | None
    revision_text: str | None
    quantity: Decimal
    unit_price: Decimal | None


class OrderSummary(ApiModel):
    id: uuid.UUID
    order_number: str
    customer_id: uuid.UUID | None
    customer_name: str | None
    po_number: str | None
    status: str
    due_date: date | None
    promised_date: date | None
    late_risk: bool
    created_at: datetime


class OrderDetail(OrderSummary):
    po_revision: str | None
    delivery_address: str | None
    notes: str | None
    quotation_id: uuid.UUID | None
    source_document_id: uuid.UUID | None
    lines: list[OrderLineOut]


class ExtractedFieldOut(ApiModel):
    id: uuid.UUID
    field_name: str
    value: str | None
    confidence: Decimal
    source_page: int | None
    source_text: str | None
    needs_check: bool
    check_reason: str | None
    corrected_value: str | None
    corrected_by: uuid.UUID | None


class FieldCorrection(BaseModel):
    field_id: uuid.UUID
    corrected_value: str


class ImpactedOrder(BaseModel):
    order_id: uuid.UUID
    order_number: str
    old_finish: date | None
    new_finish: date | None
    still_meets_due_date: bool


class PlanOptionOut(ApiModel):
    id: uuid.UUID
    option_type: Literal["as_requested", "delay", "split", "overtime", "move_other_order"]
    finish_date: date
    split_quantity_first: Decimal | None
    split_finish_date_first: date | None
    overtime_hours: Decimal
    extra_cost: Decimal
    margin: Decimal | None
    machine_load: dict[str, float] | None
    impacted_orders: list[ImpactedOrder]
    explanation: str | None
    is_recommended: bool
    status: str


class MaterialNeed(ApiModel):
    material_id: uuid.UUID
    material_code: str
    material_name: str
    unit: str
    needed: Decimal
    available: Decimal
    held: Decimal
    short: Decimal
    arrives: date | None
    last_counted_at: datetime | None


class MaterialStatusOut(ApiModel):
    material_ready_date: date | None
    hold_expires_at: datetime | None
    needs: list[MaterialNeed]
    data_warnings: list[str]


class CustomerMessageOut(ApiModel):
    id: uuid.UUID
    order_id: uuid.UUID
    plan_option_id: uuid.UUID | None
    subject: str
    draft_text: str
    status: Literal["draft", "sent_by_sales"]
    sent_at: datetime | None


# ---- materials (P2) ----
class MaterialOut(ApiModel):
    id: uuid.UUID
    code: str
    name: str
    unit: str
    min_stock: Decimal
    unit_cost: Decimal | None  # hidden (None) for the store role
    stock: Decimal
    held: Decimal
    available: Decimal
    last_counted_at: datetime | None
    warnings: list[str]


class StockMovementIn(BaseModel):
    material_id: uuid.UUID
    quantity: Decimal
    movement_type: Literal["receive", "issue", "scrap", "return", "adjust"]
    reference: str | None = None
    reason: str | None = None  # required for adjust
    order_id: uuid.UUID | None = None


class StockMovementOut(ApiModel):
    id: uuid.UUID
    material_id: uuid.UUID
    quantity: Decimal
    movement_type: str
    reference: str | None
    reason: str | None
    order_id: uuid.UUID | None
    user_id: uuid.UUID | None
    created_at: datetime


class StockHoldOut(ApiModel):
    id: uuid.UUID
    material_id: uuid.UUID
    order_id: uuid.UUID
    quantity: Decimal
    hold_type: Literal["temporary", "firm"]
    expires_at: datetime | None


class PurchaseRequestOut(ApiModel):
    id: uuid.UUID
    material_id: uuid.UUID
    supplier_id: uuid.UUID | None
    order_id: uuid.UUID | None
    quantity: Decimal
    needed_by: date | None
    status: str


class CycleCountIn(BaseModel):
    material_id: uuid.UUID
    counted_quantity: Decimal
    note: str | None = None


# ---- quotations / planning (P2) ----
class QuotationOut(ApiModel):
    id: uuid.UUID
    quote_number: str
    customer_id: uuid.UUID
    part_id: uuid.UUID
    quantity: Decimal
    unit_price: Decimal
    quoted_due_date: date | None
    status: str


class QuotationIn(BaseModel):
    customer_id: uuid.UUID
    part_id: uuid.UUID
    quantity: Decimal
    unit_price: Decimal
    quoted_due_date: date | None = None


class WhatIfRequest(BaseModel):
    part_id: uuid.UUID
    quantity: Decimal
    due_date: date


class WhatIfResult(ApiModel):
    can_meet_due_date: bool
    earliest_finish_date: date
    material_ready_date: date
    explanation: str | None


class ScheduleSlotOut(ApiModel):
    id: uuid.UUID
    order_id: uuid.UUID
    order_number: str
    machine_id: uuid.UUID
    routing_step: int
    quantity: Decimal
    start_at: datetime
    end_at: datetime
    status: Literal["tentative", "locked", "done"]
    is_overtime: bool


class MaintenanceWindowOut(ApiModel):
    machine_id: uuid.UUID
    start_at: datetime
    end_at: datetime | None
    maintenance_type: Literal["breakdown", "planned"]


class ScheduleOut(ApiModel):
    slots: list[ScheduleSlotOut]
    maintenance: list[MaintenanceWindowOut]


# ---- approvals / chat / agents / dashboard / history (P3) ----
class ApprovalSummary(ApiModel):
    id: uuid.UUID
    order_id: uuid.UUID
    order_number: str
    customer_name: str | None
    approval_type: Literal["order", "replan"]
    status: Literal["waiting", "decided", "cancelled"]
    due_date: date | None
    waiting_since: datetime
    reminded: bool


class QuotationComparison(ApiModel):
    field: str
    po_value: str | None
    quote_value: str | None
    matches: bool


class ApprovalPack(ApprovalSummary):
    document_url: str | None
    fields: list[ExtractedFieldOut]
    quotation_comparison: list[QuotationComparison]
    material: MaterialStatusOut
    plan_options: list[PlanOptionOut]
    gantt_slots: list[ScheduleSlotOut]
    customer_message: CustomerMessageOut | None
    what_changed: list[str] | None


class ApprovalDecisionIn(BaseModel):
    decision: Literal["approve", "reject", "choose_option", "question"]
    chosen_option_id: uuid.UUID | None = None
    reject_reason: Literal["replan", "counter_offer", "decline"] | None = None
    comment: str | None = None


class ChatRequest(BaseModel):
    message: str
    order_id: uuid.UUID | None = None


class AgentSummary(ApiModel):
    name: str
    job_scope: str
    uses_llm: bool
    queue_depth: int
    in_progress: int
    success_rate_today: float
    average_latency_ms: float
    tokens_today: int
    cost_today_usd: float
    dead_letter_count: int
    last_seen: datetime | None


class AgentMessageOut(ApiModel):
    message_id: uuid.UUID
    correlation_id: uuid.UUID | None
    order_id: uuid.UUID | None
    message_type: Literal["task", "result", "event"]
    from_agent: str
    to_agent: str | None
    action: str
    status: str | None
    payload: dict[str, Any]
    notes: str | None
    latency_ms: int | None
    tokens_in: int
    tokens_out: int
    cost_usd: Decimal
    sent_at: datetime


class TimelineEntry(ApiModel):
    at: datetime
    kind: Literal["state_change", "agent_message", "human_action", "document"]
    title: str
    detail: dict[str, Any] | None
    actor: str | None


class KpiTile(ApiModel):
    key: str
    label: str
    value: float
    unit: str | None
    trend: float | None


class ChartSeries(ApiModel):
    name: str
    points: list[tuple[str, float]]


class ChartOut(ApiModel):
    name: str
    series: list[ChartSeries]


class AuditEntryOut(ApiModel):
    id: uuid.UUID
    user_id: uuid.UUID | None
    agent: str | None
    action: str
    entity: str
    entity_id: str | None
    before: dict[str, Any] | None
    after: dict[str, Any] | None
    created_at: datetime


class QcCheck(ApiModel):
    name: str
    kind: Literal["first_piece", "sample", "final"]
    every_n: int | None
    spec: str | None


class QcPlanOut(ApiModel):
    id: uuid.UUID
    order_id: uuid.UUID
    checks: list[QcCheck]


class QcRecordIn(BaseModel):
    order_id: uuid.UUID
    check_name: str
    result: Literal["pass", "fail"]
    measured_value: str | None = None
    note: str | None = None


class QcRecordOut(ApiModel):
    id: uuid.UUID
    order_id: uuid.UUID
    check_name: str
    result: Literal["pass", "fail"]
    measured_value: str | None
    inspector_id: uuid.UUID | None
    note: str | None
    created_at: datetime


class MachineStatusIn(BaseModel):
    status: MachineStatus


class MachineOutputIn(BaseModel):
    count: int
    order_id: uuid.UUID | None = None


class BreakdownIn(BaseModel):
    note: str | None = None
    expected_hours: float | None = None


class MachineEventOut(ApiModel):
    id: uuid.UUID
    event_type: str
    value: str
    happened_at: datetime


class JobRef(ApiModel):
    order_id: uuid.UUID
    order_number: str
    start_at: datetime
    end_at: datetime
    quantity: Decimal


class MachineOverview(ApiModel):
    machine: MachineOut
    current_job: JobRef | None
    next_jobs: list[JobRef]
    utilisation_today: float
    recent_events: list[MachineEventOut]
    maintenance_history: list[MaintenanceWindowOut]


class FloorMachine(ApiModel):
    id: uuid.UUID
    code: str
    name: str
    machine_type: str
    status: MachineStatus
    floor_x: int
    floor_y: int
    rotation: int = 0
    current_order_number: str | None
    part_count: int
    utilisation_today: float


class FloorOut(ApiModel):
    machines: list[FloorMachine]
    orders_in_production: int
    pending_approvals: int
    layout: LayoutOut | None = None


class NotificationOut(ApiModel):
    id: uuid.UUID
    kind: str
    title: str
    body: str | None
    link: str | None
    read_at: datetime | None
    created_at: datetime


class LiveEvent(BaseModel):
    """What WS /ws sends."""

    type: Literal[
        "agent_message", "order_state_changed", "approval_created", "machine_status_changed", "notification"
    ]
    data: dict[str, Any]
    at: datetime


TokenResponse.model_rebuild()
