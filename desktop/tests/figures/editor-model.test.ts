import { describe, expect, it } from "vitest";
import type { FloorCatalogItem, FloorLayout, LayoutDecor, LayoutMachine } from "../../src/api/types";
import { iso } from "../../src/iso/iso-kit";
import { draftReducer, floorCell, footprint, layoutProblems, placementProblems, removeItem, replaceItem, rotationOffset, startDraft, wallRun } from "../../src/pages/factory-floor/editor-model";

const catalog: FloorCatalogItem[] = [
  { kind: "cnc_lathe", label: "Lathe", category: "Machines", width: 12, height: 8, solid: true, resizable: false },
  { kind: "wall", label: "Wall", category: "Structure", width: 1, height: 1, solid: true, resizable: true },
  { kind: "zone", label: "Zone", category: "Markings", width: 1, height: 1, solid: false, resizable: true },
];
const machine: LayoutMachine = { id: "machine", code: "LATHE", name: "Lathe", machine_type: "cnc_lathe", x: 0, y: 0, rotation: 0 };
const wall: LayoutDecor = { id: "wall", kind: "wall", name: "Wall", x: 20, y: 0, rotation: 0, width: 4, height: 1 };
const initial: FloorLayout = { revision: 0, origin_x: -150, origin_y: -170, columns: 40, rows: 30, machines: [], decor: [], catalog };

describe("floor placement invariants", () => {
  it("rejects overlap and rotation past an edge while allowing ground markings", () => {
    const doc = { ...initial, machines: [machine] };
    expect(placementProblems(doc, { ...machine, id: "other", x: 11 }, catalog).join()).toMatch(/Overlap/);
    expect(placementProblems(doc, { ...machine, id: "other", x: 12 }, catalog)).toEqual([]);
    expect(footprint({ ...machine, rotation: 90 }, catalog)).toEqual([8, 12]);
    expect(layoutProblems({ ...doc, rows: 8, machines: [{ ...machine, rotation: 90 }] }, catalog).join()).toMatch(/Outside/);
    expect(layoutProblems({ ...doc, decor: [{ ...wall, kind: "zone", x: 0 }] }, catalog)).toEqual([]);
    expect(layoutProblems({ ...doc, decor: [{ ...wall, x: 0 }] }, catalog).join()).toMatch(/Overlap/);
    expect(rotationOffset({ ...machine, rotation: 90 }, catalog)).toEqual([80, 0]);
  });

  it("allows correcting one legacy overlap while others remain", () => {
    const doc = { ...initial, machines: [machine, { ...machine, id: "two", code: "TWO" }, { ...machine, id: "three", code: "THREE" }] };
    expect(placementProblems(doc, { ...machine, x: 20 }, catalog)).toEqual([]);
    expect(layoutProblems(doc, catalog).length).toBeGreaterThan(0);
  });

  it("blocks a resize that clips any item and builds a single vertical wall run", () => {
    expect(layoutProblems({ ...initial, columns: 23, decor: [wall] }, catalog).join()).toMatch(/Outside/);
    expect(wallRun(wall, [5, 8], [5, 2])).toMatchObject({ x: 5, y: 2, width: 7, height: 1, rotation: 90 });
    expect(wallRun(wall, [8, 5], [2, 5])).toMatchObject({ x: 2, y: 5, width: 7, height: 1, rotation: 0 });
  });

  it("maps pointer positions back to cells through every camera quadrant", () => {
    for (const azimuth of [0, 53, 90, 180, 270, 359]) {
      const camera = { origin: [620, 360] as [number, number], scale: .73, elevation: 38, azimuth };
      expect(floorCell(iso([55, 135, 0], camera), camera, initial)).toEqual([20, 30]);
    }
  });
});

it("undoes and redoes add, move, property, delete and resize; Save preserves history and Cancel clears it", () => {
  let state = startDraft(initial);
  const steps = [replaceItem(initial, machine), replaceItem(initial, { ...machine, x: 12 }),
    replaceItem(initial, { ...machine, x: 12, name: "Renamed", rotation: 90 })];
  steps.push(removeItem(steps[2], machine.id));
  steps.push({ ...steps[3], columns: 50 });
  for (const document of steps) state = draftReducer(state, { type: "commit", document });
  expect(state.past).toHaveLength(5);
  const saved = { ...state.present, revision: 1, catalog };
  state = draftReducer(state, { type: "saved", layout: saved });
  expect(state.past).toHaveLength(5);
  for (let i = 0; i < 5; i++) state = draftReducer(state, { type: "undo" });
  expect(state.present).toEqual(startDraft(initial).present);
  for (let i = 0; i < 5; i++) state = draftReducer(state, { type: "redo" });
  expect(state.present).toEqual(state.saved);
  state = draftReducer(state, { type: "undo" });
  state = draftReducer(state, { type: "cancel" });
  expect(state.present).toEqual(state.saved);
  expect(state.past).toEqual([]);
  expect(state.future).toEqual([]);
});
