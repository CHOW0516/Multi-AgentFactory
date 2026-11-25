// Mock master data shared by several pages (P4). Read-only lists plus simple create/update.
import { ApiError, registerMock } from "../api/client";
import type { HolidayOut, MachineOut, ShiftOut, UserOut } from "../api/types";
import { appSettings, customers, holidays, machines, parts, shifts, users } from "./mock-data";

registerMock("GET", "/users", () => users);
registerMock("POST", "/users", ({ body }) => {
  const input = body as Omit<UserOut, "id" | "is_active"> & { password: string };
  if (users.some((user) => user.email === input.email)) throw new ApiError(409, "A user with this email exists");
  const user: UserOut = { id: `0a000000-0000-4000-8000-${String(users.length + 1).padStart(12, "0")}`, name: input.name,
    email: input.email, role: input.role, backup_approver_id: input.backup_approver_id ?? null, is_active: true };
  users.push(user);
  return user;
});
registerMock("PATCH", "/users/:userId", ({ params, body }) => {
  const user = users.find((candidate) => candidate.id === params.userId);
  if (!user) throw new ApiError(404, "User not found");
  const { password: _password, ...changes } = body as Partial<UserOut> & { password?: string };
  return Object.assign(user, changes);
});
registerMock("GET", "/customers", () => customers);
registerMock("GET", "/parts", () => parts);
registerMock("GET", "/machines", () => machines);
registerMock("POST", "/machines", ({ body }) => {
  const machine: MachineOut = { id: `0b000000-0000-4000-8000-${String(machines.length + 1).padStart(12, "0")}`, status: "idle",
    ...(body as Omit<MachineOut, "id" | "status">) };
  machines.push(machine);
  return machine;
});
registerMock("PATCH", "/machines/:machineId", ({ params, body }) => {
  const machine = machines.find((candidate) => candidate.id === params.machineId);
  if (!machine) throw new ApiError(404, "Machine not found");
  return Object.assign(machine, body as Partial<MachineOut>);
});
registerMock("GET", "/shifts", () => shifts);
registerMock("POST", "/shifts", ({ body }) => {
  const shift: ShiftOut = { id: `0c000000-0000-4000-8000-${String(shifts.length + 1).padStart(12, "0")}`, ...(body as Omit<ShiftOut, "id">) };
  shifts.push(shift);
  return shift;
});
registerMock("GET", "/holidays", () => holidays);
registerMock("POST", "/holidays", ({ body }) => {
  const holiday: HolidayOut = { id: `0d000000-0000-4000-8000-${String(holidays.length + 1).padStart(12, "0")}`, ...(body as Omit<HolidayOut, "id">) };
  holidays.push(holiday);
  return holiday;
});
registerMock("GET", "/settings", () => appSettings);
registerMock("PATCH", "/settings", ({ body }) => {
  Object.assign(appSettings.values, (body as { values?: Record<string, number> }).values ?? body);
  return appSettings;
});
