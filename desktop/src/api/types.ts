// Response types for every REST endpoint and WebSocket event (contract section I).
// Mirrors backend/app/schemas/api.py. Owned by P1: ask in docs/requests/<id>.md to change.
// Decimals arrive as strings (e.g. "12.50"); dates as "YYYY-MM-DD"; datetimes as ISO-8601 UTC.

export type Uuid = string;
export type DecimalString = string;
export type IsoDate = string;
export type IsoDateTime = string;

export type Role = "manager" | "sales" | "planner" | "store" | "qc" | "admin";
export type MachineStatus = "running" | "idle" | "setup" | "down" | "maintenance";
export type OrderState =
  | "RECEIVED" | "EXTRACTED" | "NEEDS_FIELD_CHECK" | "VERIFIED" | "MATERIAL_CHECKED" | "PLANNED"
  | "WAITING_APPROVAL" | "RECHECKING" | "CONFIRMED" | "REPLY_DRAFTED" | "CUSTOMER_REPLIED"
  | "IN_PRODUCTION" | "COMPLETED" | "REJECTED" | "DECLINED" | "REPLAN_NEEDED" | "FAILED"
  | "WAITING_CUSTOMER" | "CANCELLED" | "SENDER_REVIEW";
export type AgentName =
  | "orchestrator" | "order" | "material" | "planning" | "quality" | "monitoring" | "maintenance" | "simulator" | "api";

export interface Page<T> { items: T[]; total: number; page: number; page_size: number }

// ---- auth / users / master data (P1) ----
export interface UserOut { id: Uuid; name: string; email: string; role: Role; backup_approver_id: Uuid | null; is_active: boolean }
export interface TokenResponse { access_token: string; token_type: "bearer"; user: UserOut }
export interface UserCreate { name: string; email: string; role: Role; password: string; backup_approver_id?: Uuid | null }
export interface UserUpdate { name?: string; role?: Role; password?: string; backup_approver_id?: Uuid | null; is_active?: boolean }
export interface CustomerOut { id: Uuid; code: string; name: string; email: string | null; address: string | null }
export interface PartOut { id: Uuid; part_number: string; revision: string; description: string | null; customer_id: Uuid | null; qc_sample_every: number; qc_notes: string | null }
export interface BomLineOut { id: Uuid; material_id: Uuid; quantity_per_part: DecimalString; scrap_rate: DecimalString }
export interface RoutingStepOut { id: Uuid; step_number: number; machine_type: string; setup_minutes: number; cycle_seconds_per_part: DecimalString }
export interface SupplierOut { id: Uuid; name: string; email: string | null }
export interface MachineOut { id: Uuid; code: string; name: string; machine_type: string; status: MachineStatus; floor_x: number; floor_y: number }
export interface ShiftOut { id: Uuid; name: string; weekday: number; start_time: string; end_time: string }
export interface HolidayOut { id: Uuid; holiday_date: IsoDate; name: string }
export interface SettingsOut { app_mode: "demo" | "production"; currency: string; timezone: string; values: Record<string, number> }
export interface HealthOut { status: "ok" | "degraded"; database: boolean; app_mode: string }

// ---- orders (P2) ----
export interface OrderLineOut { id: Uuid; line_number: number; part_id: Uuid | null; part_number_text: string | null; revision_text: string | null; quantity: DecimalString; unit_price: DecimalString | null }
export interface OrderSummary { id: Uuid; order_number: string; customer_id: Uuid | null; customer_name: string | null; po_number: string | null; status: OrderState; due_date: IsoDate | null; promised_date: IsoDate | null; late_risk: boolean; created_at: IsoDateTime }
export interface OrderDetail extends OrderSummary { po_revision: string | null; delivery_address: string | null; notes: string | null; quotation_id: Uuid | null; source_document_id: Uuid | null; lines: OrderLineOut[] }
export interface ExtractedFieldOut { id: Uuid; field_name: string; value: string | null; confidence: DecimalString; source_page: number | null; source_text: string | null; needs_check: boolean; check_reason: string | null; corrected_value: string | null; corrected_by: Uuid | null }
export interface FieldCorrection { field_id: Uuid; corrected_value: string }
export interface ImpactedOrder { order_id: Uuid; order_number: string; old_finish: IsoDate | null; new_finish: IsoDate | null; still_meets_due_date: boolean }
export type PlanOptionType = "as_requested" | "delay" | "split" | "overtime" | "move_other_order";
export interface PlanOptionOut { id: Uuid; option_type: PlanOptionType; finish_date: IsoDate; split_quantity_first: DecimalString | null; split_finish_date_first: IsoDate | null; overtime_hours: DecimalString; extra_cost: DecimalString; margin: DecimalString | null; machine_load: Record<string, number> | null; impacted_orders: ImpactedOrder[]; explanation: string | null; is_recommended: boolean; status: string }
export interface MaterialNeed { material_id: Uuid; material_code: string; material_name: string; unit: string; needed: DecimalString; available: DecimalString; held: DecimalString; short: DecimalString; arrives: IsoDate | null; last_counted_at: IsoDateTime | null }
export interface MaterialStatusOut { material_ready_date: IsoDate | null; hold_expires_at: IsoDateTime | null; needs: MaterialNeed[]; data_warnings: string[] }
export interface CustomerMessageOut { id: Uuid; order_id: Uuid; plan_option_id: Uuid | null; subject: string; draft_text: string; status: "draft" | "sent_by_sales"; sent_at: IsoDateTime | null }

// ---- materials / quotations / planning (P2) ----
export type MovementType = "receive" | "issue" | "scrap" | "return" | "adjust";
export interface MaterialOut { id: Uuid; code: string; name: string; unit: string; min_stock: DecimalString; unit_cost: DecimalString | null; stock: DecimalString; held: DecimalString; available: DecimalString; last_counted_at: IsoDateTime | null; warnings: string[] }
export interface StockMovementIn { material_id: Uuid; quantity: DecimalString | number; movement_type: MovementType; reference?: string | null; reason?: string | null; order_id?: Uuid | null }
export interface StockMovementOut { id: Uuid; material_id: Uuid; quantity: DecimalString; movement_type: MovementType; reference: string | null; reason: string | null; order_id: Uuid | null; user_id: Uuid | null; created_at: IsoDateTime }
export interface StockHoldOut { id: Uuid; material_id: Uuid; order_id: Uuid; quantity: DecimalString; hold_type: "temporary" | "firm"; expires_at: IsoDateTime | null }
export interface PurchaseRequestOut { id: Uuid; material_id: Uuid; supplier_id: Uuid | null; order_id: Uuid | null; quantity: DecimalString; needed_by: IsoDate | null; status: string }
export interface CycleCountIn { material_id: Uuid; counted_quantity: DecimalString | number; note?: string | null }
export interface QuotationOut { id: Uuid; quote_number: string; customer_id: Uuid; part_id: Uuid; quantity: DecimalString; unit_price: DecimalString; quoted_due_date: IsoDate | null; status: string }
export interface QuotationIn { customer_id: Uuid; part_id: Uuid; quantity: DecimalString | number; unit_price: DecimalString | number; quoted_due_date?: IsoDate | null }
export interface WhatIfRequest { part_id: Uuid; quantity: DecimalString | number; due_date: IsoDate }
export interface WhatIfResult { can_meet_due_date: boolean; earliest_finish_date: IsoDate; material_ready_date: IsoDate; explanation: string | null }
export interface ScheduleSlotOut { id: Uuid; order_id: Uuid; order_number: string; machine_id: Uuid; routing_step: number; quantity: DecimalString; start_at: IsoDateTime; end_at: IsoDateTime; status: "tentative" | "locked" | "done"; is_overtime: boolean }
export interface MaintenanceWindowOut { machine_id: Uuid; start_at: IsoDateTime; end_at: IsoDateTime | null; maintenance_type: "breakdown" | "planned" }
export interface ScheduleOut { slots: ScheduleSlotOut[]; maintenance: MaintenanceWindowOut[] }

// ---- approvals / chat / agents / dashboard / history / quality / machines (P3) ----
export interface ApprovalSummary { id: Uuid; order_id: Uuid; order_number: string; customer_name: string | null; approval_type: "order" | "replan"; status: "waiting" | "decided" | "cancelled"; due_date: IsoDate | null; waiting_since: IsoDateTime; reminded: boolean }
export interface QuotationComparison { field: string; po_value: string | null; quote_value: string | null; matches: boolean }
export interface ApprovalPack extends ApprovalSummary { document_url: string | null; fields: ExtractedFieldOut[]; quotation_comparison: QuotationComparison[]; material: MaterialStatusOut; plan_options: PlanOptionOut[]; gantt_slots: ScheduleSlotOut[]; customer_message: CustomerMessageOut | null; what_changed: string[] | null }
export interface ApprovalDecisionIn { decision: "approve" | "reject" | "choose_option" | "question"; chosen_option_id?: Uuid | null; reject_reason?: "replan" | "counter_offer" | "decline" | null; comment?: string | null }
export interface ChatRequest { message: string; order_id?: Uuid | null }
export interface AgentSummary { name: AgentName; job_scope: string; uses_llm: boolean; queue_depth: number; in_progress: number; success_rate_today: number; average_latency_ms: number; tokens_today: number; cost_today_usd: number; dead_letter_count: number; last_seen: IsoDateTime | null }
export interface AgentMessageOut { message_id: Uuid; correlation_id: Uuid | null; order_id: Uuid | null; message_type: "task" | "result" | "event"; from_agent: AgentName; to_agent: AgentName | null; action: string; status: "ok" | "partial" | "failed" | null; payload: Record<string, unknown>; notes: string | null; latency_ms: number | null; tokens_in: number; tokens_out: number; cost_usd: DecimalString; sent_at: IsoDateTime }
export interface TimelineEntry { at: IsoDateTime; kind: "state_change" | "agent_message" | "human_action" | "document"; title: string; detail: Record<string, unknown> | null; actor: string | null }
export interface KpiTile { key: string; label: string; value: number; unit: string | null; trend: number | null }
export interface ChartSeries { name: string; points: [string, number][] }
export interface ChartOut { name: string; series: ChartSeries[] }
export interface AuditEntryOut { id: Uuid; user_id: Uuid | null; agent: string | null; action: string; entity: string; entity_id: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; created_at: IsoDateTime }
export interface QcCheck { name: string; kind: "first_piece" | "sample" | "final"; every_n: number | null; spec: string | null }
export interface QcPlanOut { id: Uuid; order_id: Uuid; checks: QcCheck[] }
export interface QcRecordIn { order_id: Uuid; check_name: string; result: "pass" | "fail"; measured_value?: string | null; note?: string | null }
export interface QcRecordOut { id: Uuid; order_id: Uuid; check_name: string; result: "pass" | "fail"; measured_value: string | null; inspector_id: Uuid | null; note: string | null; created_at: IsoDateTime }
export interface MachineEventOut { id: Uuid; event_type: string; value: string; happened_at: IsoDateTime }
export interface JobRef { order_id: Uuid; order_number: string; start_at: IsoDateTime; end_at: IsoDateTime; quantity: DecimalString }
export interface MachineOverview { machine: MachineOut; current_job: JobRef | null; next_jobs: JobRef[]; utilisation_today: number; recent_events: MachineEventOut[]; maintenance_history: MaintenanceWindowOut[] }
export interface FloorMachine { id: Uuid; code: string; name: string; machine_type: string; status: MachineStatus; floor_x: number; floor_y: number; rotation?: number; current_order_number: string | null; part_count: number; utilisation_today: number }
export interface FloorOut { machines: FloorMachine[]; orders_in_production: number; pending_approvals: number; layout?: FloorLayout }
export interface FloorCatalogItem { kind: string; label: string; category: "Machines" | "Structure" | "Furniture" | "Markings"; width: number; height: number; solid: boolean; resizable: boolean }
export interface GridPlacement { id: Uuid; x: number; y: number; rotation: 0 | 90 | 180 | 270 }
export interface LayoutMachine extends GridPlacement { code: string; name: string; machine_type: string }
export interface LayoutDecor extends GridPlacement { kind: string; name: string; width: number; height: number }
export interface FloorDocument { origin_x: number; origin_y: number; columns: number; rows: number; machines: LayoutMachine[]; decor: LayoutDecor[] }
export interface FloorLayout extends FloorDocument { revision: number; catalog: FloorCatalogItem[] }
export interface NotificationOut { id: Uuid; kind: string; title: string; body: string | null; link: string | null; read_at: IsoDateTime | null; created_at: IsoDateTime }

// ---- WebSocket (WS /ws) ----
// Copy of every RabbitMQ envelope plus metrics (from event.agent_message).
export interface AgentMessageEventData {
  message_id: Uuid; correlation_id: Uuid | null; order_id: Uuid | null;
  type: "task" | "result" | "event"; from_agent: AgentName; to_agent: AgentName | null; action: string;
  payload: Record<string, unknown>; status: "ok" | "partial" | "failed" | null; notes: string | null;
  attempt: number; in_reply_to: Uuid | null; reply_by: IsoDateTime | null; sent_at: IsoDateTime;
  latency_ms: number | null; tokens_in: number; tokens_out: number; cost_usd: number;
}
export interface LiveEventDataMap {
  agent_message: AgentMessageEventData;
  order_state_changed: { order_id: Uuid; from_state: OrderState | null; to_state: OrderState };
  approval_created: { approval_id: Uuid; order_id: Uuid; approval_type: "order" | "replan" };
  machine_status_changed: { machine_id: Uuid; status: MachineStatus };
  notification: { user_ids: Uuid[]; kind: string; title: string; body: string | null; link: string | null };
}
export type LiveEventType = keyof LiveEventDataMap;
export interface LiveEvent<T extends LiveEventType = LiveEventType> { type: T; data: LiveEventDataMap[T]; at: IsoDateTime }
