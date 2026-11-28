import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { machines } from "../../src/components/mock-data";
import { LineSimulatorPage } from "../../src/pages/line-simulator/LineSimulatorPage";
import { designFromMachines, freeSpot, makeBlock, newDesign } from "../../src/pages/line-simulator/model";
import { logInAs, renderPage } from "./helpers";

vi.mock("../../src/api/client", async (importOriginal) => (await import("./mock-api")).mockedClient(importOriginal));

function blocks() {
  return screen.getAllByTestId(/^line-block-/);
}

/** Drag from the port of one block to the centre of another (jsdom: canvas units = client pixels). */
function link(fromIndex: number, toIndex: number) {
  const all = blocks();
  const port = all[fromIndex].querySelector("[data-port]") as Element;
  const target = all[toIndex].getAttribute("transform")?.match(/translate\(([-\d.]+) ([-\d.]+)\)/) as RegExpMatchArray;
  const canvas = screen.getByTestId("line-canvas");
  fireEvent.pointerDown(port, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
  fireEvent.pointerUp(canvas, { clientX: Number(target[1]) + 50, clientY: Number(target[2]) + 30, pointerId: 1 });
}

describe("line model", () => {
  it("starts with Material in, Ship out and one job", () => {
    const design = newDesign();
    expect(design.blocks.map((block) => block.name)).toEqual(["Material in", "Ship out"]);
    expect(design.jobs).toHaveLength(1);
  });

  it("names blocks in order and finds free spots", () => {
    const design = newDesign();
    const first = makeBlock(design, "cnc_lathe", 300, 300);
    const second = makeBlock({ ...design, blocks: [...design.blocks, first] }, "cnc_lathe", 300, 300);
    expect([first.name, second.name]).toEqual(["CNC lathe 1", "CNC lathe 2"]);
    expect(makeBlock(design, "sink", 0, 0).name).toBe("Ship out 2");
    const spot = freeSpot({ ...design, blocks: [...design.blocks, { ...first, x: 80, y: 100 }] });
    expect(spot).not.toEqual({ x: 80, y: 100 });
  });

  it("copies real machines and fixes typed machine types", () => {
    const design = designFromMachines([
      { id: "m1", code: "QC-02", name: "QC 2", machine_type: "qc-station", status: "idle", floor_x: 500, floor_y: 300 },
    ]);
    const machine = design.blocks.find((block) => block.kind === "machine");
    expect(machine).toMatchObject({ name: "QC-02", machineType: "qc_station" });
    expect(design.links).toEqual([]);
  });

  it("never stacks copied machines on top of each other", () => {
    const sameSpot = [1, 2, 3].map((number) => ({
      id: `m${number}`, code: `M-0${number}`, name: "M", machine_type: "cnc_mill", status: "idle" as const, floor_x: 0, floor_y: 0,
    }));
    const placed = designFromMachines(sameSpot).blocks;
    const spots = new Set(placed.map((block) => `${block.x},${block.y}`));
    expect(spots.size).toBe(placed.length);
  });

  it("keeps snapped positions beyond every edge of the original board", () => {
    expect(makeBlock(newDesign(), "cnc_mill", 2013, -213)).toMatchObject({ x: 2010, y: -210 });
  });

  it("finds free positions after filling the original board", () => {
    const design = newDesign();
    for (let i = 0; i < 60; i++) {
      const spot = freeSpot(design);
      expect(design.blocks.some((block) => Math.abs(block.x - spot.x) < 112 && Math.abs(block.y - spot.y) < 64)).toBe(false);
      design.blocks.push(makeBlock(design, "cnc_mill", spot.x, spot.y));
    }
    expect(design.blocks.some((block) => block.y > 600)).toBe(true);
  });

  it("adds palette blocks in the visible area, including beyond the old board", () => {
    const area = { x: 2000, y: -1000, width: 320, height: 200 };
    const design = newDesign();
    expect(freeSpot(design, area)).toEqual({ x: 2080, y: -900 });
  });
});

describe("LineSimulatorPage", () => {
  it("builds a line, links it and runs it", async () => {
    logInAs("planner");
    const user = userEvent.setup();
    renderPage(<LineSimulatorPage />);
    expect(blocks()).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "CNC lathe" }));
    expect(blocks()).toHaveLength(3);
    expect(screen.getByLabelText("Cycle time per part (s)")).toHaveValue(90);

    await user.click(screen.getByTestId("line-run"));
    expect(screen.getByText("Fix these before running:")).toBeInTheDocument();
    expect(screen.getByText("Material in has no outgoing link.")).toBeInTheDocument();

    link(0, 2); // Material in -> lathe
    link(2, 1); // lathe -> Ship out
    expect(screen.queryByText("Fix these before running:")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("line-run"));
    const results = await screen.findByTestId("line-results");
    expect(within(results).getByText("Good parts").nextSibling).toHaveTextContent("100");
    await user.click(screen.getByRole("button", { name: "Skip to end" }));
    expect(screen.getByTestId("line-clock")).toHaveTextContent("Day 1, 03:00"); // 30 min setup + 100 x 90 s
  });

  it("saves a line and opens it again", async () => {
    logInAs("manager");
    const user = userEvent.setup();
    renderPage(<LineSimulatorPage />);
    const nameInput = screen.getByLabelText("Line name");
    await user.clear(nameInput);
    await user.type(nameInput, "Bracket line");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText('Saved "Bracket line".')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("option", { name: "Bracket line" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "New" }));
    expect(screen.getByLabelText("Line name")).toHaveValue("New line");
    await user.selectOptions(screen.getByLabelText("Open a saved line"), "Bracket line");
    await waitFor(() => expect(screen.getByLabelText("Line name")).toHaveValue("Bracket line"));
  });

  it("asks before throwing away changes and copies the factory", async () => {
    logInAs("planner");
    const user = userEvent.setup();
    renderPage(<LineSimulatorPage />);
    await user.click(screen.getByRole("button", { name: "Packing" }));
    await user.click(screen.getByRole("button", { name: "Start from my factory" }));
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(blocks()).toHaveLength(machines.length + 2));
  });

  it("removes the selected block with the Delete key", async () => {
    logInAs("planner");
    const user = userEvent.setup();
    renderPage(<LineSimulatorPage />);
    await user.click(screen.getByRole("button", { name: "CNC mill" }));
    expect(blocks()).toHaveLength(3);
    fireEvent.keyDown(screen.getByTestId("line-canvas"), { key: "Delete" });
    expect(blocks()).toHaveLength(2);
  });

  it("deletes a block and its connections from the right-click menu", async () => {
    logInAs("planner");
    renderPage(<LineSimulatorPage />);
    await userEvent.click(screen.getByRole("button", { name: "CNC mill" }));
    link(0, 2);
    link(2, 1);
    expect(screen.getAllByTestId(/^line-link-/)).toHaveLength(2);
    fireEvent.contextMenu(blocks()[2], { clientX: 200, clientY: 150 });
    const menu = screen.getByRole("menu", { name: "Element actions" });
    await userEvent.click(within(menu).getByRole("menuitem", { name: /Delete block/ }));
    expect(blocks()).toHaveLength(2);
    expect(screen.queryAllByTestId(/^line-link-/)).toHaveLength(0);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("zooms and right-drags without changing or deleting the design", async () => {
    logInAs("planner");
    renderPage(<LineSimulatorPage />);
    const canvas = screen.getByTestId("line-canvas");
    const start = canvas.getAttribute("viewBox");
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 300, clientY: 200 });
    await waitFor(() => expect(canvas.getAttribute("viewBox")).not.toBe(start));
    const zoomed = canvas.getAttribute("viewBox");
    fireEvent.pointerDown(blocks()[0], { button: 2, pointerId: 1, clientX: 80, clientY: 300 });
    fireEvent.contextMenu(blocks()[0], { clientX: 80, clientY: 300 });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.pointerMove(canvas, { buttons: 2, pointerId: 1, clientX: 180, clientY: 350 });
    fireEvent.pointerUp(canvas, { button: 2, pointerId: 1, clientX: 180, clientY: 350 });
    expect(canvas.getAttribute("viewBox")).not.toBe(zoomed);
    fireEvent.contextMenu(blocks()[0], { clientX: 180, clientY: 350 });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(blocks()).toHaveLength(2);
    expect(screen.queryByText("Not saved")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Name", { exact: true })).not.toBeInTheDocument();
  });

  it("opens actions by keyboard and dismisses without deleting", async () => {
    logInAs("planner");
    renderPage(<LineSimulatorPage />);
    fireEvent.keyDown(blocks()[0], { key: "F10", shiftKey: true });
    const action = screen.getByRole("menuitem", { name: /Delete block/ });
    expect(action).toHaveFocus();
    fireEvent.keyDown(action, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByTestId("line-canvas")).toHaveFocus();
    expect(blocks()).toHaveLength(2);
    fireEvent.contextMenu(blocks()[0]);
    fireEvent.pointerDown(screen.getByLabelText("Line name"), { button: 0 });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("deletes only the connection when its menu is used", async () => {
    logInAs("planner");
    renderPage(<LineSimulatorPage />);
    link(0, 1);
    fireEvent.contextMenu(screen.getByTestId(/^line-link-/), { clientX: 200, clientY: 250 });
    await userEvent.click(screen.getByRole("menuitem", { name: /Delete connection/ }));
    expect(screen.queryAllByTestId(/^line-link-/)).toHaveLength(0);
    expect(blocks()).toHaveLength(2);
  });
});
