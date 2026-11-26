import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, Link, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FloorLayout } from "../../src/api/types";
import { FloorEditor } from "../../src/pages/factory-floor/FloorEditor";
import { FactoryFloor } from "../../src/pages/factory-floor/FactoryFloor";
import { useAuthStore } from "../../src/shell/auth-store";
import { SettingsPage } from "../../src/pages/settings/SettingsPage";

const initial: FloorLayout = {
  revision: 0, origin_x: 0, origin_y: 0, columns: 80, rows: 60,
  machines: [{ id: "00000000-0000-4000-8000-000000000001", code: "LATHE", name: "Lathe", machine_type: "cnc_lathe", x: 10, y: 10, rotation: 0 }], decor: [],
  catalog: [
    { kind: "cnc_lathe", label: "Cnc Lathe", category: "Machines", width: 12, height: 8, solid: true, resizable: false },
    { kind: "table", label: "Work table", category: "Furniture", width: 9, height: 5, solid: true, resizable: false },
  ],
};
let client: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  fetchMock = vi.fn(async (_url: string, options?: RequestInit) => options?.method === "PUT" ?
    Response.json({ ...JSON.parse(options.body as string), catalog: initial.catalog, revision: 1 }) : Response.json([]));
  vi.stubGlobal("fetch", fetchMock);
  useAuthStore.setState({ token: null, user: null, ready: true });
});
afterEach(() => { client.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function mount() {
  const close = vi.fn();
  const router = createMemoryRouter([
    { path: "/", element: <><Link to="/other">Other page</Link><FloorEditor initial={structuredClone(initial)} liveMachines={[]} onClose={close} /></> },
    { path: "/other", element: <h1>Other page</h1> },
  ]);
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { close, router, scene: screen.getByRole("group", { name: /interactive isometric factory floor/i }) };
}
function addTable(scene: HTMLElement) {
  fireEvent.click(screen.getByRole("button", { name: "Add Work table" }));
  fireEvent.keyDown(scene, { key: "ArrowRight" });
  fireEvent.keyDown(scene, { key: "ArrowRight" });
  fireEvent.keyDown(scene, { key: "Enter" });
}

it("groups keyboard placement, provides hotkeys and preserves history after Save", async () => {
  const { scene, close } = mount();
  expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  addTable(scene);
  expect(screen.getByRole("button", { name: "Work table" })).toBeInTheDocument();
  fireEvent.keyDown(scene, { key: "z", ctrlKey: true });
  expect(screen.queryByRole("button", { name: "Work table" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  fireEvent.keyDown(scene, { key: "y", ctrlKey: true });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.getByText("All changes saved")).toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(close).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Work table" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
});

it("keeps a failed-save draft editable and supports property, rotation, removal and resize history", async () => {
  fetchMock.mockImplementation(async (_url: string, options?: RequestInit) => options?.method === "PUT" ? Response.json({ detail: "Database unavailable" }, { status: 503 }) : Response.json([]));
  const { scene } = mount();
  fireEvent.click(screen.getByRole("button", { name: "Lathe, Idle" }));
  const name = screen.getByLabelText("Name");
  fireEvent.change(name, { target: { value: "Edited lathe" } }); fireEvent.blur(name);
  fireEvent.keyDown(scene, { key: "r" });
  expect(screen.getByText("Rotation: 90°")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText(/Save failed: Database unavailable/);
  expect(screen.getByRole("button", { name: "Edited lathe, Idle" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  fireEvent.keyDown(scene, { key: "Delete" });
  expect(screen.queryByRole("button", { name: "Edited lathe, Idle" })).not.toBeInTheDocument();
  fireEvent.keyDown(scene, { key: "z", metaKey: true });
  expect(screen.getByRole("button", { name: "Edited lathe, Idle" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Width (cells)"), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "Resize floor" }));
  expect(screen.getByText(/Resize blocked/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Width (cells)"), { target: { value: "100" } });
  fireEvent.click(screen.getByRole("button", { name: "Resize floor" }));
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.getByLabelText("Width (cells)")).toHaveValue(80);
});

it("blocks page navigation, logout and tab close while dirty and clears guards after Cancel", async () => {
  const { scene, router, close } = mount();
  addTable(scene);
  const unload = new Event("beforeunload", { cancelable: true });
  expect(window.dispatchEvent(unload)).toBe(false);
  const logout = vi.fn();
  const event = new CustomEvent("workspace-leave", { cancelable: true, detail: { proceed: logout } });
  act(() => { expect(window.dispatchEvent(event)).toBe(false); });
  const dialog = screen.getByRole("dialog", { name: "Discard unsaved floor changes?" });
  expect(dialog).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(logout).not.toHaveBeenCalled();
  await act(async () => { await router.navigate("/other"); });
  expect(router.state.location.pathname).toBe("/");
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await screen.findByRole("heading", { name: "Other page" });
  expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(true);
  expect(close).not.toHaveBeenCalled();
});

it("keeps the draft and history mounted during a background layout refresh", async () => {
  useAuthStore.setState({ user: { id: "admin", name: "Admin", email: "admin@test.local", role: "admin", backup_approver_id: null, is_active: true } });
  let finishRefresh: (response: Response) => void = () => undefined;
  let reads = 0;
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith("/floor/layout")) {
      if (++reads === 1) return Response.json(initial);
      return new Promise<Response>((resolve) => { finishRefresh = resolve; });
    }
    if (url.endsWith("/floor")) return Response.json({ machines: [], pending_approvals: 0, orders_in_production: 0, layout: initial });
    return Response.json([]);
  });
  const router = createMemoryRouter([{ path: "/", element: <FactoryFloor /> }]);
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Edit floor" }));
  await screen.findByRole("button", { name: "Add Work table" });
  const scene = screen.getByRole("group", { name: /interactive isometric factory floor/i });
  addTable(scene);
  act(() => { void client.invalidateQueries({ queryKey: ["floor-layout"] }); });
  await waitFor(() => expect(reads).toBe(2));
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  act(() => { finishRefresh(Response.json({ ...initial, revision: 99 })); });
  await waitFor(() => expect(client.isFetching({ queryKey: ["floor-layout"] })).toBe(0));
  expect(screen.getByRole("button", { name: "Work table" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
});

it("opens Edit Floor directly from the styled Settings machines action", async () => {
  useAuthStore.setState({ user: { id: "admin", name: "Admin", email: "admin@test.local", role: "admin", backup_approver_id: null, is_active: true } });
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith("/floor/layout")) return Response.json(initial);
    if (url.endsWith("/floor")) return Response.json({ machines: [], pending_approvals: 0, orders_in_production: 0 });
    if (url.endsWith("/settings")) return Response.json({ app_mode: "demo", currency: "MYR", timezone: "Asia/Kuala_Lumpur", values: {} });
    return Response.json([]);
  });
  const router = createMemoryRouter([
    { path: "/settings", element: <SettingsPage /> },
    { path: "/", element: <FactoryFloor /> },
  ], { initialEntries: ["/settings"] });
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("tab", { name: "Machines" }));
  const link = screen.getByRole("link", { name: "Edit floor layout" });
  expect(link).toHaveClass("button", "button-primary");
  expect(link).toHaveAttribute("href", "/?edit=floor");
  fireEvent.click(link);
  await screen.findByRole("heading", { name: "Edit floor" });
  await screen.findByRole("button", { name: "Add Work table" });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("heading", { name: "Factory floor" })).toBeInTheDocument();
});

it("keeps the editor deep link read-only for a non-admin", async () => {
  useAuthStore.setState({ user: { id: "planner", name: "Planner", email: "planner@test.local", role: "planner", backup_approver_id: null, is_active: true } });
  fetchMock.mockImplementation(async (url: string) => url.endsWith("/floor") ?
    Response.json({ machines: [], pending_approvals: 0, orders_in_production: 0 }) : Response.json([]));
  const router = createMemoryRouter([{ path: "/", element: <FactoryFloor /> }], { initialEntries: ["/?edit=floor"] });
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  expect(screen.getByRole("heading", { name: "Factory floor" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Edit floor" })).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/floor/layout"))).toBe(false);
});
