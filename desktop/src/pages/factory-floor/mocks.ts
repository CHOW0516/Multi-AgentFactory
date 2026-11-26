import { ApiError, registerMock } from "../../api/client";
import type { FloorLayout, FloorOut, JobRef, MachineOverview, MachineStatus, Role, TokenResponse } from "../../api/types";
import { changeDemoMachine, demoMachineLog, demoMachines, demoMaintenanceHistory, demoOrders } from "../../figures/demo-events";
import { useAuthStore } from "../../shell/auth-store";
import { initialMockLayout } from "./mock-layout";
import { layoutProblems } from "./editor-model";

const statuses = new Set<MachineStatus>(["running", "setup", "idle", "down", "maintenance"]);

let installed = false;
let savedLayout: FloorLayout | null = null;
const currentLayout = () => structuredClone(savedLayout ?? initialMockLayout());

// Route discovery runs this after the shared client's eager mock imports have evaluated.
export function installFloorMocks() {
  if (installed) return;
  installed = true;
  registerMock("GET", "/floor/layout", currentLayout);
  registerMock("PUT", "/floor/layout", ({ body }) => {
    if (useAuthStore.getState().user?.role !== "admin") throw new ApiError(403, "Your role cannot do this");
    const previous = currentLayout();
    const input = body as Omit<FloorLayout, "catalog">;
    if (input.revision !== previous.revision) throw new ApiError(409, "The floor changed in another session. Your draft is kept.");
    if (input.origin_x !== previous.origin_x || input.origin_y !== previous.origin_y) throw new ApiError(422, "The floor origin cannot change");
    const errors = layoutProblems(input, previous.catalog);
    if (errors.length) throw new ApiError(422, errors.join("; "));
    for (const machine of input.machines) if (demoMachines.some((m) => m.code === machine.code && m.id !== machine.id))
      throw new ApiError(409, `Machine code ${machine.code} is already registered`);
    const next: FloorLayout = structuredClone({ ...input, catalog: initialMockLayout().catalog, revision: previous.revision + 1 });
    for (const placed of input.machines) {
      const changes = { id: placed.id, code: placed.code, name: placed.name, machine_type: placed.machine_type,
        floor_x: input.origin_x + placed.x * 10, floor_y: input.origin_y + placed.y * 10 };
      const existing = demoMachines.find((m) => m.id === placed.id);
      if (existing) Object.assign(existing, changes);
      else demoMachines.push({ ...changes, status: "idle", current_order_number: null, part_count: 0, utilisation_today: 0 });
    }
    next.catalog = initialMockLayout().catalog;
    savedLayout = next;
    return currentLayout();
  });
  registerMock("GET", "/floor", (): FloorOut => ({
    machines: currentLayout().machines.map((placement) => ({ ...demoMachines.find((m) => m.id === placement.id)!, rotation: placement.rotation })),
    layout: currentLayout(),
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
