import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRef } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __answerFromMockForTests, emitMockEvent } from "../../src/api/client";
import type { AgentMessageEventData, FloorOut } from "../../src/api/types";
import { demoMachines } from "../../src/figures/demo-events";
import { useFigureFrames, useMotionVisibility } from "../../src/figures/motion";
import { AgentMap } from "../../src/pages/agent-map/AgentMap";
import { installAgentMocks } from "../../src/pages/agent-map/mocks";
import { parcelFor, replayPlan } from "../../src/pages/agent-map/model";
import { FactoryFloor } from "../../src/pages/factory-floor/FactoryFloor";
import { FloorScene } from "../../src/pages/factory-floor/FloorScene";
import { installFloorMocks } from "../../src/pages/factory-floor/mocks";
import { floorProjection, locateInView, initialView } from "../../src/pages/factory-floor/floor-camera";
import { useAuthStore } from "../../src/shell/auth-store";
import { CompactList } from "../../src/components/CompactList";

const at = "2026-11-25T00:00:00Z";
function message(id: string, type: "task" | "result", sent_at = at): AgentMessageEventData {
  return {
    message_id: id, correlation_id: "test-link", order_id: null, type,
    from_agent: type === "task" ? "orchestrator" : "planning", to_agent: type === "task" ? "planning" : "orchestrator",
    action: "plan_order", attempt: 1, status: type === "result" ? "failed" : null,
    payload: {}, notes: null, in_reply_to: null, reply_by: null, sent_at, latency_ms: null, tokens_in: 0, tokens_out: 0, cost_usd: 0,
  };
}

let client: QueryClient;
let floor: FloorOut;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  installFloorMocks();
  installAgentMocks();
  useAuthStore.setState({ token: null, user: null, ready: true });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  floor = await __answerFromMockForTests("GET", "/floor", undefined) as FloorOut;
  fetchMock = vi.fn(async (input: string) => {
    const path = input.split("/api")[1];
    const response = path === "/floor" ? floor : path === "/health" ? { app_mode: "demo" } :
      await __answerFromMockForTests("GET", path, undefined);
    return Response.json(response);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  client.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const provide = (view: React.ReactNode) => <QueryClientProvider client={client}><MemoryRouter>{view}</MemoryRouter></QueryClientProvider>;

it("previews three records and expands and collapses the remaining history", () => {
  render(<CompactList items={["Job 1", "Job 2", "Job 3", "Job 4", "Job 5"]}
    itemKey={(item) => item} render={(item) => item} label="jobs" empty="No jobs." />);
  expect(screen.getByText("Job 3")).toBeVisible();
  expect(screen.getByText("Job 4")).not.toBeVisible();
  const disclosure = screen.getByText("Show 2 more jobs");
  fireEvent.click(disclosure);
  expect(screen.getByText("Job 5")).toBeVisible();
  fireEvent.click(screen.getByText("Show fewer jobs"));
  expect(screen.getByText("Job 4")).not.toBeVisible();
});

describe("factory floor", () => {
  it("focuses moderately from far away and preserves a useful close view", () => {
    const camera = floorProjection(54, 38);
    const point: [number, number, number] = [400, 300, 40];
    expect(locateInView({ ...initialView, zoom: .6 }, point, camera, [0, 0]).zoom).toBe(1.45);
    expect(locateInView({ ...initialView, zoom: 1.8 }, point, camera, [0, 0]).zoom).toBe(1.8);
    expect(locateInView({ ...initialView, zoom: 2.75 }, point, camera, [0, 0]).zoom).toBeLessThan(2);
  });
  it("reflects live machine state on the matching stack light", async () => {
    render(provide(<FactoryFloor />));
    const bay = await screen.findByRole("button", { name: /CNC Lathe 1, Running/ });
    const light = bay.querySelector("[data-stack-light]");
    expect(light).toHaveAttribute("data-status", "running");
    const machine = floor.machines.find((item) => item.code === "LATHE-01")!;
    machine.status = "down";
    act(() => emitMockEvent({ type: "machine_status_changed", at, data: { machine_id: machine.id, status: "down" } }));
    await waitFor(() => expect(light).toHaveAttribute("data-status", "down"));
  });

  it("opens the overview for the clicked machine", async () => {
    render(provide(<FactoryFloor />));
    const scene = await screen.findByRole("group", { name: /interactive isometric factory floor/i });
    fireEvent.click(await within(scene).findByRole("button", { name: /Fiber Laser Cutter/ }));
    const dialog = await screen.findByRole("dialog", { name: "Fiber Laser Cutter" });
    expect(dialog).toBeInTheDocument();
    const id = demoMachines.find((entry) => entry.code === "LASER-01")!.id;
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.endsWith(`/machines/${id}/overview`))).toBe(true));
    expect(await screen.findByText("Utilisation today")).toBeInTheDocument();
    await waitFor(() => expect(scene).toHaveAttribute("data-zoom", "1.45"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Focus machine" }));
    await waitFor(() => expect(scene).toHaveAttribute("data-zoom", "1.45"));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(dialog).not.toBeInTheDocument();
  });

  it("orbits and zooms independently and can reset the camera", async () => {
    render(provide(<FactoryFloor />));
    const scene = await screen.findByRole("group", { name: /interactive isometric factory floor/i });
    expect(fireEvent.contextMenu(scene)).toBe(false);
    const startingAngle = scene.getAttribute("data-azimuth");
    fireEvent.click(screen.getByRole("button", { name: "Rotate left" }));
    await waitFor(() => expect(scene).not.toHaveAttribute("data-azimuth", startingAngle));
    fireEvent.keyDown(scene, { key: "+" });
    await waitFor(() => expect(scene).toHaveAttribute("data-zoom", "1.20"));
    fireEvent.click(screen.getByRole("button", { name: "Reset camera" }));
    await waitFor(() => expect(scene).toHaveAttribute("data-zoom", "1.00"));
    expect(scene).toHaveAttribute("data-azimuth", startingAngle);
  });

  it("paints a delivery cart behind the bay when it stops on the far side", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    const mill = demoMachines.find((machine) => machine.code === "MILL-01")!;
    const { container } = render(<FloorScene machines={[mill]} approvals={0} active={null}
      onInspect={() => undefined} onHover={() => undefined}
      arrival={{ id: "mill-delivery", x: mill.floor_x, y: mill.floor_y }} />);
    const cart = container.querySelector("[data-cart]")!;
    const machine = screen.getByRole("button", { name: /CNC Mill 1/ });
    expect(cart.compareDocumentPosition(machine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("agent map", () => {
  it("focuses a station in a non-modal inspector and keeps the camera usable", async () => {
    render(provide(<AgentMap />));
    const scene = screen.getByRole("group", { name: /interactive isometric agent control room/i });
    fireEvent.click(await screen.findByRole("button", { name: "Planning station" }));
    const inspector = await screen.findByRole("dialog", { name: "Planning" });
    expect(inspector.tagName).toBe("SECTION");
    await waitFor(() => expect(scene).toHaveAttribute("data-zoom", "1.45"));
    const startingAngle = scene.getAttribute("data-azimuth");
    fireEvent.click(screen.getByRole("button", { name: "Rotate right" }));
    await waitFor(() => expect(scene).not.toHaveAttribute("data-azimuth", startingAngle));
    fireEvent.keyDown(inspector, { key: "Escape" });
    expect(inspector).not.toBeInTheDocument();
  });
  it("creates one token on the destination rail for one live task", async () => {
    const { container } = render(provide(<AgentMap />));
    await screen.findByRole("button", { name: "Planning station" });
    const event = { type: "agent_message", at, data: message("planning-task", "task") } as const;
    expect(parcelFor(event.data)).toEqual({ id: "planning-task", link: "planning", outbound: true, kind: "task" });
    act(() => { emitMockEvent(event); emitMockEvent(event); });
    await waitFor(() => expect(container.querySelectorAll('[data-parcel="planning-task"][data-rail="planning"]')).toHaveLength(1));
  });

  it("marks the originating station when a failed result arrives", async () => {
    render(provide(<AgentMap />));
    const station = await screen.findByRole("button", { name: "Planning station" });
    act(() => emitMockEvent({ type: "agent_message", at, data: message("planning-failure", "result") }));
    expect(station).toHaveAttribute("data-failed", "true");
  });

  it("replays messages in timestamp order with shared tracks reserved in sequence", () => {
    const task = message("task", "task");
    const result = message("result", "result", "2026-11-25T00:00:00.500Z");
    const next = { ...message("next", "task", "2026-11-25T00:00:00.600Z"), to_agent: "quality" as const };
    const replay = replayPlan([next, result, task, task]);
    expect(replay.ordered.map((entry) => entry.message_id)).toEqual(["task", "result", "next"]);
    expect(replay.parcels.map((entry) => entry.id)).toEqual(["task", "result", "next"]);
    expect(replay.parcels[1].start).toBeGreaterThan(replay.parcels[0].end);
    expect(replay.parcels[2].start).toBeGreaterThanOrEqual(replay.parcels[1].start);
  });
});

function MotionProbe({ draw }: { draw: (elapsed: number, delta: number) => void }) {
  const scene = useRef<HTMLDivElement>(null);
  const { visible, reduced } = useMotionVisibility(scene);
  useFigureFrames(visible && !reduced, draw);
  return <div ref={scene}>{reduced ? "Still" : "Animated"}</div>;
}

describe("figure motion", () => {
  it("stops frame callbacks when the document becomes hidden", async () => {
    const draw = vi.fn();
    render(<MotionProbe draw={draw} />);
    await waitFor(() => expect(draw).toHaveBeenCalled());
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    const stopped = draw.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 65));
    expect(draw).toHaveBeenCalledTimes(stopped);
  });

  it("keeps a still scene when reduced motion is requested", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    const draw = vi.fn();
    render(<MotionProbe draw={draw} />);
    expect(screen.getByText("Still")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 65));
    expect(draw).not.toHaveBeenCalled();
  });
});
