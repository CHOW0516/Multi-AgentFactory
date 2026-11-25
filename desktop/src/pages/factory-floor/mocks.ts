import { ApiError, registerMock } from "../../api/client";
import type { FloorOut, JobRef, MachineOverview, MachineStatus, Role, TokenResponse } from "../../api/types";
import { changeDemoMachine, demoMachineLog, demoMachines, demoMaintenanceHistory, demoOrders } from "../../figures/demo-events";

const statuses = new Set<MachineStatus>(["running", "setup", "idle", "down", "maintenance"]);

let installed = false;

// Route discovery runs this after the shared client's eager mock imports have evaluated.
export function installFloorMocks() {
  if (installed) return;
  installed = true;
  registerMock("GET", "/floor", (): FloorOut => ({
    machines: demoMachines.map((machine) => ({ ...machine })),
    orders_in_production: demoOrders.filter((order) => order.status === "IN_PRODUCTION").length,
    pending_approvals: demoOrders.filter((order) => order.status === "WAITING_APPROVAL").length,
  }));

  registerMock("GET", "/machines/:id/overview", ({ params }): MachineOverview => {
    const machine = demoMachines.find((entry) => entry.id === params.id);
    if (!machine) throw new ApiError(404, "Machine not found");
    function job(order: typeof demoOrders[number], offset: number): JobRef {
      const start = Date.now() + offset;
      return { order_id: order.id, order_number: order.order_number, start_at: new Date(start).toISOString(),
        end_at: new Date(start + 3_600_000).toISOString(), quantity: "80" };
    }
    const order = demoOrders.find((entry) => entry.order_number === machine.current_order_number);
    return {
      machine: { ...machine }, current_job: order ? job(order, -1_200_000) : null,
      next_jobs: demoOrders.filter((entry) => entry.id !== order?.id && entry.status === "IN_PRODUCTION").map((entry, index) => job(entry, (index + 1) * 3_600_000)),
      utilisation_today: machine.utilisation_today, recent_events: demoMachineLog(machine.id),
      maintenance_history: demoMaintenanceHistory(machine.id),
    };
  });

  registerMock("POST", "/machines/:id/status", ({ params, body }) => {
    const status = (body as { status?: MachineStatus } | undefined)?.status;
    if (!demoMachines.some((entry) => entry.id === params.id)) throw new ApiError(404, "Machine not found");
    if (!status || !statuses.has(status)) throw new ApiError(422, "Invalid status");
    changeDemoMachine(params.id, status);
    return { status };
  });

  registerMock("POST", "/machines/:id/breakdown", ({ params, body }) => {
    if (!demoMachines.some((entry) => entry.id === params.id)) throw new ApiError(404, "Machine not found");
    const note = (body as { note?: string } | undefined)?.note;
    changeDemoMachine(params.id, "down", note || "Breakdown recorded");
    return { status: "down" };
  });

  const loginMocks = import.meta.glob("../login/mocks.ts");
  if (!Object.keys(loginMocks).length) {
    registerMock("POST", "/auth/login", ({ body }): TokenResponse => {
      const { email, password } = (body ?? {}) as { email?: string; password?: string };
      const match = email?.match(/^(manager|planner|sales|store|qc|admin)@factory\.local$/);
      if (!match || password !== "demo") throw new ApiError(401, "Use a demo role email and password demo");
      const role = match[1] as Role;
      return { access_token: `mock-${role}`, token_type: "bearer",
        user: { id: `mock-${role}`, name: `Demo ${role}`, email: email!, role, backup_approver_id: null, is_active: true } };
    });
  }
}
