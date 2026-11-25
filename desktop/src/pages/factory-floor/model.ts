import type { AgentMessageEventData, FloorMachine, FloorOut, MachineStatus } from "../../api/types";

export const floorKey = ["p5", "floor"] as const;
export const overviewKey = (id: string) => ["p5", "machine", id];

export const statusNames: Record<MachineStatus, string> = {
  running: "Running", setup: "Setup", idle: "Idle", down: "Down", maintenance: "Maintenance",
};

export function withMachineStatus(floor: FloorOut | undefined, id: string, status: MachineStatus) {
  if (!floor) return floor;
  return { ...floor, machines: floor.machines.map((machine) => machine.id === id ? { ...machine, status } : machine) };
}

export function issueDestination(message: AgentMessageEventData, machines: FloorMachine[]) {
  if (message.from_agent !== "material" || message.type !== "result" || message.status !== "ok") return undefined;
  const payload = message.payload;
  const issue = payload.stock_issued === true || payload.movement_type === "issue" ||
    message.action === "issue_stock" || message.action === "issue_material";
  if (!issue) return undefined;
  const machineId = payload.machine_id;
  if (typeof machineId === "string") return machines.find((machine) => machine.id === machineId);
  const order = payload.order_number;
  if (typeof order !== "string" || !order) return undefined;
  const assigned = machines.filter((machine) => machine.current_order_number === order);
  return assigned.length === 1 ? assigned[0] : undefined;
}

export function mechanismTransform(kind: string, elapsed: number) {
  const phase = elapsed / 3200 * Math.PI * 2;
  const sweep = (1 - Math.cos(phase)) / 2;
  switch (kind) {
    case "cnc_lathe": return `rotate(${(elapsed / 14) % 360} 13 15)`;
    case "cnc_mill": return `translate(0 ${sweep * 13})`;
    case "press_brake": return `translate(0 ${sweep * 12})`;
    case "laser_cutter": return `translate(${sweep * 48} 0)`;
    default: return "";
  }
}
