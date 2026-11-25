import { useEffect } from "react";
import { emitMockEvent, USE_MOCKS } from "../api/client";
import type { AgentMessageEventData, AgentName, FloorMachine, MachineStatus, MaintenanceWindowOut, OrderSummary } from "../api/types";

export const demoAgents = ["order", "material", "planning", "quality", "monitoring", "maintenance", "simulator"] as const;
const actions: Record<typeof demoAgents[number], string> = {
  order: "extract_document", material: "check_and_hold", planning: "plan_order", quality: "create_qc_plan",
  monitoring: "record_machine_status", maintenance: "check_machine", simulator: "release_order",
};
const clock = () => new Date().toISOString();
const demoId = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
export const demoOrders: OrderSummary[] = [
  ["SO-2026-0412", "IN_PRODUCTION"], ["SO-2026-0418", "IN_PRODUCTION"], ["SO-2026-0421", "WAITING_APPROVAL"],
].map(([order_number, status], index) => ({
  id: demoId(100 + index), order_number, status: status as OrderSummary["status"], customer_id: null,
  customer_name: null, po_number: null, due_date: null, promised_date: null, late_risk: false, created_at: clock(),
}));

const bays = [
  ["LATHE-01", "CNC Lathe 1", "cnc_lathe", 250, 200, "running", 42],
  ["LATHE-02", "CNC Lathe 2", "cnc_lathe", 400, 200, "setup", 0],
  ["MILL-01", "CNC Mill 1", "cnc_mill", 250, 450, "running", 18],
  ["MILL-02", "CNC Mill 2", "cnc_mill", 400, 450, "idle", 0],
  ["LASER-01", "Fiber Laser Cutter", "laser_cutter", 650, 200, "running", 65],
  ["BRAKE-01", "Press Brake", "press_brake", 650, 450, "down", 7],
  ["QC-01", "QC Station", "qc_station", 850, 300, "maintenance", 0],
  ["PACK-01", "Packing Table", "packing", 850, 600, "idle", 0],
] as const;

export const demoMachines: FloorMachine[] = bays.map(([code, name, machine_type, floor_x, floor_y, status, part_count], index) => ({
  id: demoId(index + 1), code, name, machine_type, floor_x, floor_y, status, part_count,
  current_order_number: status === "running" || status === "setup" || status === "down" ? demoOrders[index % 2].order_number : null,
  utilisation_today: part_count ? Math.round((.42 + index * .065) * 100) / 100 : 0,
}));

let serial = 10_000;
const messages: AgentMessageEventData[] = [];
const machineLogs = new Map<string, { id: string; event_type: string; value: string; happened_at: string }[]>();
const maintenanceHistory = new Map<string, MaintenanceWindowOut[]>(demoMachines.flatMap((machine) =>
  machine.status === "down" || machine.status === "maintenance" ? [[machine.id, [{
    machine_id: machine.id, start_at: clock(), end_at: null, maintenance_type: machine.status === "down" ? "breakdown" : "planned",
  }]]] : []));
const active = new Map<AgentName, AgentMessageEventData>();

export function demoMachineLog(id: string) { return machineLogs.get(id) ?? []; }
export function demoMaintenanceHistory(id: string) { return maintenanceHistory.get(id) ?? []; }
export function demoMessageLog() { return messages; }
export function demoInProgress(agent: AgentName) { return active.has(agent) ? 1 : 0; }

export function changeDemoMachine(id: string, status: MachineStatus, note?: string) {
  const machine = demoMachines.find((entry) => entry.id === id);
  if (!machine) return;
  const at = clock();
  if (status !== machine.status) {
    const windows = demoMaintenanceHistory(id).map((item) => item.end_at === null ? { ...item, end_at: at } : item);
    if (status === "down" || status === "maintenance") windows.unshift({
      machine_id: id, start_at: at, end_at: null, maintenance_type: status === "down" ? "breakdown" : "planned",
    });
    maintenanceHistory.set(id, windows);
  }
  machine.status = status;
  const history = demoMachineLog(id);
  machineLogs.set(id, [{ id: demoId(serial++), event_type: note ? "breakdown" : "status_changed", value: note || status, happened_at: at }, ...history].slice(0, 50));
  emitMockEvent({ type: "machine_status_changed", at, data: { machine_id: id, status } });
}

function makeMessage(agent: typeof demoAgents[number], type: AgentMessageEventData["type"], orderId: string,
  sentAt: string, task?: AgentMessageEventData, failed = false, payload: Record<string, unknown> = {}): AgentMessageEventData {
  const message_id = demoId(serial++);
  return {
    message_id, correlation_id: task?.correlation_id ?? message_id, order_id: orderId, type,
    from_agent: type === "task" ? "orchestrator" : agent, to_agent: type === "task" ? agent : "orchestrator",
    action: task?.action ?? actions[agent], payload, status: type === "result" ? (failed ? "failed" : "ok") : null,
    notes: failed ? "Demo timeout while waiting for the machine response." : null,
    attempt: 1, in_reply_to: task?.message_id ?? null, reply_by: null, sent_at: sentAt,
    latency_ms: task ? Date.parse(sentAt) - Date.parse(task.sent_at) : null,
    tokens_in: task && agent === "order" ? 530 : 0, tokens_out: task && agent === "order" ? 104 : 0,
    cost_usd: task && agent === "order" ? .0027 : 0,
  };
}

for (const [orderIndex, order] of demoOrders.entries()) {
  const start = Date.now() - (orderIndex + 1) * 100_000;
  demoAgents.slice(0, 4).forEach((agent, index) => {
    const task = makeMessage(agent, "task", order.id, new Date(start + index * 2300).toISOString());
    messages.push(task, makeMessage(agent, "result", order.id, new Date(start + index * 2300 + 800).toISOString(), task, orderIndex === 1 && index === 2));
  });
}

let turn = 0;
function broadcastDemoMessage() {
  const step = turn++;
  const agent = demoAgents[Math.floor(step / 2) % demoAgents.length];
  const order = demoOrders[Math.floor(step / 4) % demoOrders.length];
  const at = clock();
  const task = active.get(agent);
  let message: AgentMessageEventData;
  if (task) {
    const failed = step % 31 === 11;
    const target = demoMachines[0];
    const issued = agent === "material" && step % 28 === 3 &&
      task.order_id === demoOrders.find((entry) => entry.order_number === target.current_order_number)?.id;
    message = makeMessage(agent, "result", task.order_id ?? order.id, at, task, failed,
      issued ? { stock_issued: true, machine_id: target.id, order_number: target.current_order_number } : { order_id: task.order_id });
    active.delete(agent);
  } else if (agent === "simulator") {
    message = makeMessage(agent, "event", order.id, at, undefined, false, { order_number: order.order_number });
  } else {
    message = makeMessage(agent, "task", order.id, at, undefined, false, { order_id: order.id });
    active.set(agent, message);
  }
  messages.push(message);
  if (messages.length > 1500) messages.splice(24, 1);
  emitMockEvent({ type: "agent_message", at, data: message });
}

let listeners = 0;
let stopTimers: (() => void) | undefined;

export function useDemoEvents() {
  useEffect(() => {
    if (!USE_MOCKS) return;
    if (++listeners === 1) {
      const rate = Math.min(5, Math.max(.1, Number(import.meta.env.VITE_P5_MOCK_MESSAGES_PER_SECOND) || .6));
      const messageTimer = window.setInterval(() => {
        if (document.visibilityState !== "hidden") broadcastDemoMessage();
      }, 1000 / rate);
      const statusTimer = window.setInterval(() => {
        if (document.visibilityState === "hidden") return;
        const machine = demoMachines.find((entry) => entry.code === "MILL-02");
        if (!machine) return;
        const status = machine.status === "running" ? "idle" : machine.status === "setup" ? "running" : "setup";
        if (status === "running") {
          machine.current_order_number = demoOrders[1].order_number;
          machine.part_count += 4;
        }
        if (status === "idle") machine.current_order_number = null;
        changeDemoMachine(machine.id, status);
      }, 6200);
      stopTimers = () => {
        window.clearInterval(messageTimer);
        window.clearInterval(statusTimer);
      };
    }
    return () => {
      if (--listeners === 0) stopTimers?.();
    };
  }, []);
}
