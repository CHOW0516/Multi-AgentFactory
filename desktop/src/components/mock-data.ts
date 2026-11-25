// Shared, mutable demo data for every P4 mocks.ts (VITE_USE_MOCKS=true and unit tests).
// 8 machines, 10 customers, and orders in every state. Mock handlers change it in place,
// so approving or entering stock really changes what the next request returns.
import type {
  ApprovalPack, ApprovalSummary, AuditEntryOut, CustomerMessageOut, CustomerOut, ExtractedFieldOut, HolidayOut,
  MachineOut, MaterialOut, MaterialStatusOut, NotificationOut, OrderDetail, OrderState, PartOut, PlanOptionOut,
  PurchaseRequestOut, QcPlanOut, QcRecordOut, QuotationOut, ScheduleSlotOut, SettingsOut, ShiftOut, StockHoldOut,
  StockMovementOut, TimelineEntry, UserOut, MaintenanceWindowOut,
} from "../api/types";

const DAY = 86_400_000;
const startOfToday = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
export const isoDay = (offsetDays: number) => new Date(startOfToday + offsetDays * DAY).toISOString().slice(0, 10);
export const isoTime = (offsetHours: number) => new Date(startOfToday + 8 * 3_600_000 + offsetHours * 3_600_000).toISOString();
const id = (prefix: string, number: number) => `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;

export const users: UserOut[] = [
  { id: id("u0000001", 1), name: "Admin", email: "admin@factory.local", role: "admin", backup_approver_id: null, is_active: true },
  { id: id("u0000001", 2), name: "Aisha Manager", email: "manager@factory.local", role: "manager", backup_approver_id: id("u0000001", 3), is_active: true },
  { id: id("u0000001", 3), name: "Daniel Backup Manager", email: "manager2@factory.local", role: "manager", backup_approver_id: null, is_active: true },
  { id: id("u0000001", 4), name: "Mei Sales", email: "sales@factory.local", role: "sales", backup_approver_id: null, is_active: true },
  { id: id("u0000001", 5), name: "Ravi Planner", email: "planner@factory.local", role: "planner", backup_approver_id: null, is_active: true },
  { id: id("u0000001", 6), name: "Siti Store", email: "store@factory.local", role: "store", backup_approver_id: null, is_active: true },
  { id: id("u0000001", 7), name: "Kumar QC", email: "qc@factory.local", role: "qc", backup_approver_id: null, is_active: true },
];

export const machines: MachineOut[] = [
  ["CNC-01", "Haas VF-2 mill", "cnc_mill", "running", 1, 1],
  ["CNC-02", "Haas VF-4 mill", "cnc_mill", "running", 2, 1],
  ["CNC-03", "DMG Mori mill", "cnc_mill", "idle", 3, 1],
  ["LTH-01", "Mazak lathe", "cnc_lathe", "running", 1, 2],
  ["LTH-02", "Okuma lathe", "cnc_lathe", "setup", 2, 2],
  ["PRS-01", "Amada press brake", "press", "down", 3, 2],
  ["WLD-01", "Fronius weld cell", "welding", "idle", 1, 3],
  ["DBR-01", "Deburr and wash", "finishing", "maintenance", 2, 3],
].map(([code, name, machineType, status, floorX, floorY], index) => ({
  id: id("m0000001", index + 1), code: code as string, name: name as string, machine_type: machineType as string,
  status: status as MachineOut["status"], floor_x: floorX as number, floor_y: floorY as number,
}));

export const customers: CustomerOut[] = [
  ["ACME", "Acme Automation Sdn Bhd"], ["BRT", "Borneo Rail Tech"], ["CLX", "Coolex Systems"],
  ["DYN", "Dynamo Pumps"], ["EVM", "EV Motion"], ["FLX", "Flexi Pack"], ["GRN", "Green Grid Energy"],
  ["HMD", "Hemadi Medical"], ["IND", "Indah Robotics"], ["JTK", "Jentek Aerospace"],
].map(([code, name], index) => ({
  id: id("c0000001", index + 1), code, name, email: `purchasing@${code.toLowerCase()}.example`,
  address: `${10 + index} Jalan Industri ${index + 1}, Shah Alam`,
}));

export const parts: PartOut[] = customers.map((customer, index) => ({
  id: id("p0000001", index + 1), part_number: `${customer.code}-${1000 + index * 7}`, revision: "BCDEF"[index % 5],
  description: ["Motor bracket", "Bogie spacer", "Heat sink plate", "Impeller shaft", "Battery clamp", "Roller pin",
    "Busbar mount", "Probe housing", "Gripper finger", "Fitting nut"][index],
  customer_id: customer.id, qc_sample_every: 50, qc_notes: null,
}));

export const materials: MaterialOut[] = [
  ["AL6061-50", "Aluminium 6061 bar Ø50", "kg", 200, 340, 120, "12.40"],
  ["AL6061-PL10", "Aluminium 6061 plate 10 mm", "kg", 150, 90, 60, "13.10"],
  ["SS304-25", "Stainless 304 bar Ø25", "kg", 120, 260, 40, "18.90"],
  ["SS316-SH2", "Stainless 316 sheet 2 mm", "sheet", 20, 12, 8, "210.00"],
  ["MS-PL6", "Mild steel plate 6 mm", "sheet", 25, 64, 10, "145.00"],
  ["BR-C360-20", "Brass C360 bar Ø20", "kg", 50, 75, 0, "32.00"],
  ["POM-40", "POM rod Ø40", "m", 30, 22, 6, "48.00"],
  ["CU-110-BB", "Copper busbar 30×5", "m", 40, 95, 30, "61.00"],
  ["FAST-M6", "M6 socket screws", "pcs", 2000, 5400, 800, "0.18"],
  ["FAST-M8", "M8 nyloc nuts", "pcs", 2000, 1600, 400, "0.22"],
  ["PAINT-GR", "Powder coat grey", "kg", 40, 55, 0, "26.00"],
  ["PACK-BOX-S", "Carton box small", "pcs", 300, 820, 150, "1.40"],
].map(([code, name, unit, minStock, stock, held, cost], index) => {
  const available = (stock as number) - (held as number);
  const warnings: string[] = [];
  if (available < (minStock as number)) warnings.push("Below minimum stock");
  if (index === 3) warnings.push("Not counted for 60 days");
  return {
    id: id("x0000001", index + 1), code: code as string, name: name as string, unit: unit as string,
    min_stock: String(minStock), unit_cost: cost as string, stock: String(stock), held: String(held),
    available: String(available), last_counted_at: isoTime(index === 3 ? -24 * 60 : -24 * (index + 2)), warnings,
  };
});

const ALL_STATES: OrderState[] = [
  "RECEIVED", "EXTRACTED", "NEEDS_FIELD_CHECK", "VERIFIED", "MATERIAL_CHECKED", "PLANNED", "WAITING_APPROVAL",
  "RECHECKING", "CONFIRMED", "REPLY_DRAFTED", "CUSTOMER_REPLIED", "IN_PRODUCTION", "COMPLETED", "REJECTED",
  "DECLINED", "REPLAN_NEEDED", "FAILED",
];
// One order per state, plus a few more to make lists feel real.
const orderStates: OrderState[] = [...ALL_STATES, "WAITING_APPROVAL", "IN_PRODUCTION", "IN_PRODUCTION", "COMPLETED", "NEEDS_FIELD_CHECK"];

export const orders: OrderDetail[] = orderStates.map((status, index) => {
  const customer = customers[index % customers.length];
  const part = parts[index % parts.length];
  const quantity = [200, 500, 1000, 250, 800][index % 5];
  return {
    id: id("o0000001", index + 1), order_number: `SO-2026-${String(400 + index).padStart(4, "0")}`,
    customer_id: customer.id, customer_name: customer.name, po_number: `${customer.code}-PO-${41200 + index * 13}`,
    status, due_date: isoDay(7 + (index % 6) * 4), promised_date: ["CONFIRMED", "REPLY_DRAFTED", "IN_PRODUCTION", "COMPLETED"].includes(status) ? isoDay(7 + (index % 6) * 4) : null,
    late_risk: index % 5 === 2, created_at: isoTime(-6 - index * 5),
    po_revision: null, delivery_address: customer.address, notes: null, quotation_id: null, source_document_id: id("d0000001", index + 1),
    lines: [{
      id: id("l0000001", index + 1), line_number: 1, part_id: part.id, part_number_text: part.part_number,
      revision_text: part.revision, quantity: String(quantity), unit_price: (8 + index * 0.75).toFixed(2),
    }],
  };
});

export function findOrder(orderId: string): OrderDetail | undefined {
  return orders.find((order) => order.id === orderId);
}

export const fieldsByOrder: Record<string, ExtractedFieldOut[]> = {};
for (const order of orders) {
  const line = order.lines[0];
  const flagged = order.status === "NEEDS_FIELD_CHECK";
  const rows: [string, string | null, number, boolean, string | null][] = [
    ["po_number", order.po_number, 0.99, false, null],
    ["customer", order.customer_name, 0.97, false, null],
    ["part_number", line.part_number_text, 0.95, false, null],
    ["revision", line.revision_text, flagged ? 0.62 : 0.93, flagged, flagged ? "Revision differs from the quotation (C)" : null],
    ["quantity", line.quantity, 0.96, false, null],
    ["unit_price", line.unit_price, 0.94, false, null],
    ["due_date", order.due_date, flagged ? 0.55 : 0.92, flagged, flagged ? "Date written as 12/05/26; could be 12 May or 5 Dec" : null],
    ["delivery_address", order.delivery_address, 0.9, false, null],
  ];
  fieldsByOrder[order.id] = rows.map(([fieldName, value, confidence, needsCheck, reason], index) => ({
    id: `${order.id.slice(0, 24)}${String(index + 1).padStart(12, "0")}`, field_name: fieldName, value,
    confidence: confidence.toFixed(2), source_page: 1, source_text: value, needs_check: needsCheck, check_reason: reason,
    corrected_value: null, corrected_by: null,
  }));
}

export function materialStatusFor(orderId: string): MaterialStatusOut {
  const short = orderId.endsWith("7");
  return {
    material_ready_date: isoDay(short ? 6 : 1), hold_expires_at: isoTime(30),
    needs: [
      { material_id: materials[0].id, material_code: materials[0].code, material_name: materials[0].name, unit: "kg",
        needed: "180", available: materials[0].available, held: "180", short: "0", arrives: null, last_counted_at: materials[0].last_counted_at },
      { material_id: materials[3].id, material_code: materials[3].code, material_name: materials[3].name, unit: "sheet",
        needed: "14", available: materials[3].available, held: short ? "4" : "14", short: short ? "10" : "0",
        arrives: short ? isoDay(6) : null, last_counted_at: materials[3].last_counted_at },
      { material_id: materials[8].id, material_code: materials[8].code, material_name: materials[8].name, unit: "pcs",
        needed: "2000", available: materials[8].available, held: "2000", short: "0", arrives: null, last_counted_at: materials[8].last_counted_at },
    ],
    data_warnings: short ? ["SS316-SH2 was last counted 60 days ago"] : [],
  };
}

export function planOptionsFor(order: OrderDetail): PlanOptionOut[] {
  const due = order.due_date ?? isoDay(14);
  const impacted = [{ order_id: orders[11].id, order_number: orders[11].order_number, old_finish: isoDay(9), new_finish: isoDay(10), still_meets_due_date: true }];
  const base = { split_quantity_first: null, split_finish_date_first: null, machine_load: { "CNC-01": 0.82, "LTH-01": 0.64 }, status: "proposed" };
  return [
    { ...base, id: `${order.id.slice(0, 30)}aaaaaa`, option_type: "as_requested", finish_date: due, overtime_hours: "0", extra_cost: "0",
      margin: "0.24", impacted_orders: [], explanation: "Fits the requested date with today's load; no other order moves.", is_recommended: !order.id.endsWith("7") },
    { ...base, id: `${order.id.slice(0, 30)}bbbbbb`, option_type: "overtime", finish_date: due, overtime_hours: "6", extra_cost: "540.00",
      margin: "0.21", impacted_orders: [], explanation: "6 hours of Saturday overtime on CNC-01 keeps the date if the stainless sheet arrives late.", is_recommended: false },
    { ...base, id: `${order.id.slice(0, 30)}cccccc`, option_type: "delay", finish_date: isoDay(21), overtime_hours: "0", extra_cost: "0",
      margin: "0.24", impacted_orders: [], explanation: "Finishing 6 days later needs no overtime and waits for the material delivery.", is_recommended: order.id.endsWith("7") },
    { ...base, id: `${order.id.slice(0, 30)}dddddd`, option_type: "move_other_order", finish_date: due, overtime_hours: "0", extra_cost: "0",
      margin: "0.24", impacted_orders: impacted, explanation: `Moves ${impacted[0].order_number} by one day; it still meets its own due date.`, is_recommended: false },
  ];
}

export const customerMessages: Record<string, CustomerMessageOut> = {};
export function customerMessageFor(order: OrderDetail, kind: "confirm" | "counter" = "confirm"): CustomerMessageOut {
  const existing = customerMessages[order.id];
  if (existing && kind === "confirm") return existing;
  const message: CustomerMessageOut = {
    id: `${order.id.slice(0, 30)}eeeeee`, order_id: order.id, plan_option_id: null,
    subject: `Re: Purchase order ${order.po_number}`,
    draft_text: kind === "confirm"
      ? `Dear ${order.customer_name},\n\nThank you for PO ${order.po_number}. We confirm ${order.lines[0].quantity} pcs of ${order.lines[0].part_number_text} rev ${order.lines[0].revision_text}, delivery on ${order.due_date}.\n\nBest regards,\nMei, Sales`
      : `Dear ${order.customer_name},\n\nThank you for PO ${order.po_number}. We cannot deliver on ${order.due_date}. We can propose delivery on ${isoDay(21)} at the quoted price. Please let us know if this works for you.\n\nBest regards,\nMei, Sales`,
    status: "draft", sent_at: null,
  };
  customerMessages[order.id] = message;
  return message;
}

export const scheduleSlots: ScheduleSlotOut[] = orders
  .filter((order) => ["CONFIRMED", "REPLY_DRAFTED", "IN_PRODUCTION", "PLANNED", "WAITING_APPROVAL", "COMPLETED"].includes(order.status))
  .flatMap((order, index) => {
    const machine = machines[index % machines.length];
    const nextMachine = machines[(index + 3) % machines.length];
    const startHours = -24 + index * 20;
    const status: ScheduleSlotOut["status"] = order.status === "COMPLETED" ? "done" : ["PLANNED", "WAITING_APPROVAL"].includes(order.status) ? "tentative" : "locked";
    return [
      { id: `${order.id.slice(0, 30)}111111`, order_id: order.id, order_number: order.order_number, machine_id: machine.id, routing_step: 1,
        quantity: order.lines[0].quantity, start_at: isoTime(startHours), end_at: isoTime(startHours + 16), status, is_overtime: false },
      { id: `${order.id.slice(0, 30)}222222`, order_id: order.id, order_number: order.order_number, machine_id: nextMachine.id, routing_step: 2,
        quantity: order.lines[0].quantity, start_at: isoTime(startHours + 18), end_at: isoTime(startHours + 28), status, is_overtime: index % 4 === 1 },
    ];
  });

export const maintenanceWindows: MaintenanceWindowOut[] = [
  { machine_id: machines[5].id, start_at: isoTime(-3), end_at: isoTime(20), maintenance_type: "breakdown" },
  { machine_id: machines[7].id, start_at: isoTime(-1), end_at: isoTime(6), maintenance_type: "planned" },
];

export const approvals: ApprovalSummary[] = orders
  .filter((order) => order.status === "WAITING_APPROVAL" || order.status === "REPLAN_NEEDED")
  .map((order, index) => ({
    id: id("a0000001", index + 1), order_id: order.id, order_number: order.order_number, customer_name: order.customer_name,
    approval_type: order.status === "REPLAN_NEEDED" ? "replan" : "order", status: "waiting", due_date: order.due_date,
    waiting_since: isoTime(-3 - index * 20), reminded: index === 1,
  }));

export function approvalPackFor(approval: ApprovalSummary): ApprovalPack {
  const order = findOrder(approval.order_id) as OrderDetail;
  const line = order.lines[0];
  return {
    ...approval,
    document_url: `/orders/${order.id}/document`,
    fields: fieldsByOrder[order.id].map((field, index) => (index === 6 && approval.approval_type === "order"
      ? { ...field, corrected_value: field.value, corrected_by: users[3].id, confidence: "0.58" } : field)),
    quotation_comparison: [
      { field: "Part / revision", po_value: `${line.part_number_text} rev ${line.revision_text}`, quote_value: `${line.part_number_text} rev ${line.revision_text}`, matches: true },
      { field: "Quantity", po_value: line.quantity, quote_value: line.quantity, matches: true },
      { field: "Unit price", po_value: line.unit_price, quote_value: (Number(line.unit_price) + 0.4).toFixed(2), matches: false },
      { field: "Due date", po_value: order.due_date, quote_value: order.due_date, matches: true },
    ],
    material: materialStatusFor(order.id),
    plan_options: planOptionsFor(order),
    gantt_slots: scheduleSlots.filter((slot) => slot.order_id === order.id || slot.order_id === orders[11].id),
    customer_message: customerMessageFor(order),
    what_changed: approval.approval_type === "replan"
      ? ["PRS-01 is down until tomorrow 4 PM (breakdown)", "Step 2 moved from PRS-01 to the next free slot; finish date moves 2 days"]
      : null,
  };
}

export function timelineFor(order: OrderDetail): TimelineEntry[] {
  const reached = Math.max(ALL_STATES.indexOf(order.status), 0);
  const steps = ALL_STATES.slice(0, Math.min(reached + 1, 11));
  const entries: TimelineEntry[] = [
    { at: order.created_at, kind: "document", title: `PO email received from ${order.customer_name}`, detail: null, actor: "order agent" },
  ];
  steps.forEach((state, index) => {
    if (["REJECTED", "DECLINED", "FAILED", "REPLAN_NEEDED"].includes(state) && state !== order.status) return;
    entries.push({ at: new Date(new Date(order.created_at).getTime() + (index + 1) * 900_000).toISOString(), kind: "state_change",
      title: `State: ${state}`, detail: null, actor: "orchestrator" });
    if (state === "EXTRACTED") entries.push({ at: new Date(new Date(order.created_at).getTime() + (index + 1) * 900_000 + 60_000).toISOString(),
      kind: "agent_message", title: "Order agent extracted 8 fields (2 flagged)", detail: { tokens_in: 5120, tokens_out: 640 }, actor: "order agent" });
  });
  if (order.status !== steps.at(-1)) entries.push({ at: new Date().toISOString(), kind: "state_change", title: `State: ${order.status}`, detail: null, actor: "orchestrator" });
  return entries;
}

export const quotations: QuotationOut[] = parts.slice(0, 8).map((part, index) => ({
  id: id("q0000001", index + 1), quote_number: `Q-2026-${String(180 + index).padStart(4, "0")}`, customer_id: part.customer_id as string,
  part_id: part.id, quantity: String([200, 500, 1000, 250][index % 4]), unit_price: (9 + index * 0.8).toFixed(2),
  quoted_due_date: isoDay(10 + index * 3), status: index < 6 ? "open" : index === 6 ? "accepted" : "expired",
}));

export const movements: StockMovementOut[] = materials.flatMap((material, index) => [
  { id: id("s0000001", index * 3 + 1), material_id: material.id, quantity: String(Number(material.stock) + 100), movement_type: "receive" as const,
    reference: `GRN-${5000 + index}`, reason: null, order_id: null, user_id: users[5].id, created_at: isoTime(-24 * (10 + index)) },
  { id: id("s0000001", index * 3 + 2), material_id: material.id, quantity: "-80", movement_type: "issue" as const,
    reference: orders[11].order_number, reason: null, order_id: orders[11].id, user_id: users[5].id, created_at: isoTime(-24 * 3) },
  { id: id("s0000001", index * 3 + 3), material_id: material.id, quantity: "-20", movement_type: "scrap" as const,
    reference: null, reason: "Setup scrap", order_id: orders[11].id, user_id: users[5].id, created_at: isoTime(-24) },
]);

export const holds: StockHoldOut[] = orders.slice(5, 11).map((order, index) => ({
  id: id("h0000001", index + 1), material_id: materials[index % 4].id, order_id: order.id, quantity: String(20 + index * 15),
  hold_type: ["CONFIRMED", "REPLY_DRAFTED"].includes(order.status) ? "firm" : "temporary",
  expires_at: ["CONFIRMED", "REPLY_DRAFTED"].includes(order.status) ? null : isoTime(24 + index * 6),
}));

export const purchaseRequests: PurchaseRequestOut[] = [
  { id: id("r0000001", 1), material_id: materials[3].id, supplier_id: null, order_id: orders[6].id, quantity: "10", needed_by: isoDay(5), status: "open" },
  { id: id("r0000001", 2), material_id: materials[1].id, supplier_id: null, order_id: null, quantity: "120", needed_by: isoDay(9), status: "ordered" },
];

export const qcPlans: Record<string, QcPlanOut> = {};
for (const order of orders.filter((candidate) => ["IN_PRODUCTION", "COMPLETED", "CONFIRMED"].includes(candidate.status))) {
  qcPlans[order.id] = { id: `${order.id.slice(0, 30)}999999`, order_id: order.id, checks: [
    { name: "First piece dimensions", kind: "first_piece", every_n: null, spec: "All drawing dims ±0.05" },
    { name: "Sample hole position", kind: "sample", every_n: 50, spec: "Ø6.0 +0.02/-0 at 25.00 ±0.03" },
    { name: "Final visual and count", kind: "final", every_n: null, spec: "No burrs, correct quantity" },
  ] };
}
export const qcRecords: QcRecordOut[] = Object.keys(qcPlans).slice(0, 2).map((orderId, index) => ({
  id: id("k0000001", index + 1), order_id: orderId, check_name: "First piece dimensions", result: "pass", measured_value: "OK",
  inspector_id: users[6].id, note: null, created_at: isoTime(-20 + index),
}));

export const notifications: NotificationOut[] = [
  { id: id("n0000001", 1), kind: "approval_created", title: `Approval needed: ${approvals[0]?.order_number ?? ""}`, body: "Plan ready with 4 options.",
    link: "/approvals", read_at: null, created_at: isoTime(-2) },
  { id: id("n0000001", 2), kind: "machine_down", title: "PRS-01 is down", body: "Breakdown reported; replan started.",
    link: "/schedule", read_at: null, created_at: isoTime(-3) },
  { id: id("n0000001", 3), kind: "field_check", title: "Field check needed", body: "2 fields need a check on a new PO.",
    link: `/orders/${orders[2].id}`, read_at: isoTime(-10), created_at: isoTime(-12) },
];

export const auditEntries: AuditEntryOut[] = Array.from({ length: 40 }, (_unused, index) => {
  const order = orders[index % orders.length];
  const byAgent = index % 3 !== 0;
  return {
    id: id("z0000001", index + 1), user_id: byAgent ? null : users[(index % 5) + 1].id, agent: byAgent ? ["orchestrator", "order", "planning", "material"][index % 4] : null,
    action: ["state_change", "update", "decision", "stock_movement"][index % 4], entity: ["order", "order", "approval", "material"][index % 4],
    entity_id: order.id, before: index % 2 === 0 ? { status: "PLANNED", due_date: order.due_date } : null,
    after: { status: order.status, due_date: order.due_date }, created_at: isoTime(-index * 3),
  };
});

export const shifts: ShiftOut[] = [1, 2, 3, 4, 5].flatMap((weekday) => [
  { id: id("t0000001", weekday * 2), name: "Day", weekday, start_time: "08:00", end_time: "17:00" },
  { id: id("t0000001", weekday * 2 + 1), name: "Evening", weekday, start_time: "17:00", end_time: "23:00" },
]);

export const holidays: HolidayOut[] = [
  { id: id("y0000001", 1), holiday_date: isoDay(30), name: "Company holiday" },
  { id: id("y0000001", 2), holiday_date: isoDay(55), name: "Public holiday" },
];

export const appSettings: SettingsOut = {
  app_mode: "demo", currency: "MYR", timezone: "Asia/Kuala_Lumpur",
  values: { extraction_confidence_threshold: 0.85, approval_reminder_hours: 4, approval_escalation_hours: 8,
    hold_expiry_hours: 48, min_margin: 0.15, overtime_cost_per_hour: 90, llm_daily_cost_limit_usd: 20 },
};

export const machineById = (machineId: string) => machines.find((machine) => machine.id === machineId);
export const materialById = (materialId: string) => materials.find((material) => material.id === materialId);
export const customerById = (customerId: string) => customers.find((customer) => customer.id === customerId);
export const partById = (partId: string) => parts.find((part) => part.id === partId);
export const userById = (userId: string | null) => users.find((user) => user.id === userId);

/** Wraps a list as the contract's Page<T>, honouring page and page_size. */
export function asPage<Item>(items: Item[], query: URLSearchParams) {
  const pageSize = Number(query.get("page_size") ?? 200);
  const page = Number(query.get("page") ?? 1);
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, page_size: pageSize };
}
