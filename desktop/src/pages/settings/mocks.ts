import { registerMock } from "../../api/client";

// Master data mocks (users, machines, shifts, holidays, settings) live in components/mocks.ts.
registerMock("POST", "/demo/reset", () => ({ status: "ok" }));
