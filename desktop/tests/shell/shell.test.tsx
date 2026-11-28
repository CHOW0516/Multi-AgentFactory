import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lazy } from "react";
import { emitMockEvent, queryClient, registerMock, useLiveEvents, apiFetch } from "../../src/api/client";
import type { LiveEvent, UserOut } from "../../src/api/types";
import { App } from "../../src/App";
import { useAuthStore } from "../../src/shell/auth-store";
import { discoverGlobals } from "../../src/shell/Layout";
import { canOpen, discoverRoutes, sidebarRoutes, type PageRoute } from "../../src/shell/routes";

const manager: UserOut = { id: "u1", name: "Aisha", email: "m@x", role: "manager", backup_approver_id: null, is_active: true };

const routes: PageRoute[] = [
  { path: "/", label: "Factory floor", icon: "factory", roles: [], order: 10, element: <h1>Floor page</h1> },
  { path: "/approvals", label: "Approvals", icon: "approvals", roles: ["manager"], order: 20, element: <h1>Approvals page</h1> },
  { path: "/materials", label: "Materials", icon: "materials", roles: ["store"], order: 50, element: <h1>Materials page</h1> },
  { path: "/orders/:orderId", label: "Order", icon: "orders", roles: [], order: 31, element: <h1>Order detail</h1>, showInSidebar: false },
];

function renderApp(path = "/", appRoutes = routes) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}><App routes={appRoutes} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ token: null, user: null, ready: true });
  vi.unstubAllGlobals();
});

describe("route discovery and access", () => {
  it("sorts discovered routes and skips bad modules", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const found = discoverRoutes({
      "../pages/b/route.tsx": { default: routes[1] },
      "../pages/a/route.tsx": { default: routes[0] },
      "../pages/bad/route.tsx": { default: undefined },
    });
    expect(found.map((route) => route.path)).toEqual(["/", "/approvals"]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("filters the sidebar by role and hides detail pages", () => {
    expect(sidebarRoutes(routes, "manager").map((route) => route.label)).toEqual(["Factory floor", "Approvals"]);
    expect(sidebarRoutes(routes, "admin").map((route) => route.label)).toEqual(["Factory floor", "Approvals", "Materials"]);
    expect(canOpen(routes[2], "manager")).toBe(false);
    expect(canOpen(routes[2], undefined)).toBe(false);
  });

  it("finds global pieces", () => {
    const found = discoverGlobals({ "../global/chat/index.tsx": { default: () => null }, "../global/x/index.tsx": {} });
    expect(found.map((item) => item.name)).toEqual(["chat"]);
  });
});

describe("App", () => {
  it("keeps navigation available while a page loads on demand", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
    let finish!: (value: { default: () => React.ReactNode }) => void;
    const load = vi.fn(() => new Promise<{ default: () => React.ReactNode }>((resolve) => { finish = resolve; }));
    const DeferredPage = lazy(load);
    useAuthStore.setState({ token: "t", user: manager, ready: true });
    renderApp("/", [...routes, { path: "/deferred", label: "Deferred", icon: "orders", roles: [], order: 40, element: <DeferredPage /> }]);
    expect(load).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("link", { name: "Deferred" }));
    expect(load).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "Floor page" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeVisible();
    await act(async () => finish({ default: () => <h1>Deferred page</h1> }));
    expect(await screen.findByRole("heading", { name: "Deferred page" })).toBeVisible();
    expect(screen.queryByLabelText("Loading")).not.toBeInTheDocument();
  });

  it("sends a logged-out user to the fallback login", async () => {
    renderApp("/approvals");
    expect(await screen.findByRole("form", { name: "Log in" })).toBeInTheDocument();
  });

  it("uses the login page from pages/login when it exists", () => {
    const loginRoute: PageRoute = { path: "/login", label: "Login", icon: "dot", roles: [], order: 0, public: true, element: <h1>P4 login</h1> };
    renderApp("/", [...routes, loginRoute]);
    expect(screen.getByText("P4 login")).toBeInTheDocument();
  });

  it("logs in through the fallback form", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ access_token: "token-1", token_type: "bearer", user: manager }),
      { status: 200, headers: { "content-type": "application/json" } },
    )));
    renderApp("/login");
    await userEvent.type(screen.getByLabelText("Email"), "m@x");
    await userEvent.type(screen.getByLabelText("Password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByText("Floor page")).toBeInTheDocument();
    expect(useAuthStore.getState().token).toBe("token-1");
  });

  it("shows pages by role and blocks pages the role cannot open", () => {
    useAuthStore.setState({ token: "t", user: manager, ready: true });
    renderApp("/materials");
    expect(screen.getByText("You do not have access to this page.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Approvals/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Materials/ })).not.toBeInTheDocument();
  });

  it("keeps route icons accessible and navigable while collapsed", async () => {
    useAuthStore.setState({ token: "t", user: manager, ready: true });
    renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-expanded", "false");
    const approvals = screen.getByRole("link", { name: "Approvals" });
    expect(approvals).toHaveAttribute("data-tooltip", "Approvals");
    await userEvent.click(approvals);
    expect(screen.getByRole("heading", { name: "Approvals page" })).toBeInTheDocument();
  });

  it("logs out on a 401 from the API", async () => {
    useAuthStore.setState({ token: "expired", user: manager, ready: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Not logged in" }), { status: 401 })));
    await expect(apiFetch("/auth/me")).rejects.toThrow("Not logged in");
    expect(useAuthStore.getState().token).toBeNull();
  });
});

describe("live events", () => {
  it("delivers only the requested event types", () => {
    const received: string[] = [];
    function Listener() {
      useLiveEvents(["machine_status_changed"], (event) => received.push(event.data.status));
      return null;
    }
    render(<Listener />);
    const machineEvent: LiveEvent<"machine_status_changed"> = {
      type: "machine_status_changed", data: { machine_id: "m1", status: "down" }, at: "2026-11-25T00:00:00Z",
    };
    act(() => {
      emitMockEvent(machineEvent);
      emitMockEvent({ type: "notification", data: { user_ids: [], kind: "x", title: "t", body: null, link: null }, at: "" });
    });
    expect(received).toEqual(["down"]);
  });
});

describe("mock registry", () => {
  it("matches path parameters", async () => {
    registerMock("GET", "/test-orders/:orderId", ({ params }) => ({ id: params.orderId }));
    const { answerForTest } = await import("./mock-helper");
    await waitFor(async () => expect(await answerForTest("GET", "/test-orders/42")).toEqual({ id: "42" }));
  });
});
