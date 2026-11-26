import type { FloorCatalogItem, FloorDocument, FloorLayout, GridPlacement, LayoutDecor, LayoutMachine } from "../../api/types";
import { cameraOf, type Flat, type Projection } from "../../iso/iso-kit";

export const cellSize = 10;
export type FloorItem = LayoutMachine | LayoutDecor;
export const isMachine = (item: FloorItem): item is LayoutMachine => "machine_type" in item;
export const documentOf = ({ origin_x, origin_y, columns, rows, machines, decor }: FloorDocument): FloorDocument =>
  ({ origin_x, origin_y, columns, rows, machines, decor });
export const sameDocument = (a: FloorDocument, b: FloorDocument) => JSON.stringify(a) === JSON.stringify(b);

export function footprint(item: FloorItem, catalog: FloorCatalogItem[]): [number, number] {
  const definition = catalog.find((entry) => entry.kind === (isMachine(item) ? item.machine_type : item.kind) &&
    (entry.category === "Machines") === isMachine(item));
  const [w, h] = isMachine(item) ? [definition?.width ?? 12, definition?.height ?? 9] : [item.width, item.height];
  return item.rotation === 90 || item.rotation === 270 ? [h, w] : [w, h];
}

export function layoutProblems(doc: FloorDocument, catalog: FloorCatalogItem[]): string[] {
  const errors: string[] = [];
  if (![doc.columns, doc.rows].every((n) => Number.isInteger(n) && n >= 1 && n <= 10000)) errors.push("Floor dimensions must be 1–10,000 cells.");
  const solids: { item: FloorItem; w: number; h: number }[] = [];
  const ids = new Set<string>();
  const codes = new Set<string>();
  for (const item of [...doc.machines, ...doc.decor]) {
    const [w, h] = footprint(item, catalog);
    const definition = catalog.find((entry) => entry.kind === (isMachine(item) ? item.machine_type : item.kind) &&
      (entry.category === "Machines") === isMachine(item));
    if (ids.has(item.id)) errors.push("An item ID occurs more than once.");
    ids.add(item.id);
    if (!item.name.trim() || item.name.trim().length > 120) errors.push("Names need 1–120 characters.");
    if (isMachine(item)) {
      if (!item.code.trim() || item.code.trim().length > 30) errors.push("Machine codes need 1–30 characters.");
      if (!item.machine_type.trim() || item.machine_type.trim().length > 40) errors.push("Machine types need 1–40 characters.");
      if (codes.has(item.code.trim())) errors.push(`Duplicate machine code: ${item.code}`);
      codes.add(item.code.trim());
    } else {
      if (!definition) errors.push(`Unknown decor: ${item.kind}`);
      if (definition && !definition.resizable && (item.width !== definition.width || item.height !== definition.height)) errors.push(`Invalid footprint: ${item.name}`);
      if (item.kind === "wall" && item.height !== 1) errors.push("Wall runs must be one cell thick.");
    }
    if (![item.x, item.y, w, h].every(Number.isInteger) || item.x < 0 || item.y < 0 || w < 1 || h < 1 ||
      item.x + w > doc.columns || item.y + h > doc.rows) errors.push(`Outside the floor: ${item.name}`);
    if (isMachine(item) || definition?.solid) {
      for (const other of solids) if (item.x < other.item.x + other.w && item.x + w > other.item.x &&
        item.y < other.item.y + other.h && item.y + h > other.item.y) errors.push(`Overlap: ${item.name} and ${other.item.name}`);
      solids.push({ item, w, h });
    }
  }
  return errors;
}

export function replaceItem(doc: FloorDocument, item: FloorItem): FloorDocument {
  return isMachine(item) ? { ...doc, machines: doc.machines.some((m) => m.id === item.id) ? doc.machines.map((m) => m.id === item.id ? item : m) : [...doc.machines, item] }
    : { ...doc, decor: doc.decor.some((m) => m.id === item.id) ? doc.decor.map((m) => m.id === item.id ? item : m) : [...doc.decor, item] };
}

export const removeItem = (doc: FloorDocument, id: string): FloorDocument =>
  ({ ...doc, machines: doc.machines.filter((m) => m.id !== id), decor: doc.decor.filter((m) => m.id !== id) });

export function placementProblems(doc: FloorDocument, item: FloorItem, catalog: FloorCatalogItem[]): string[] {
  const errors = layoutProblems({ ...doc, machines: isMachine(item) ? [item] : [], decor: isMachine(item) ? [] : [item] }, catalog);
  const solid = (part: FloorItem) => isMachine(part) || catalog.find((e) => e.category !== "Machines" && e.kind === part.kind)?.solid;
  if (solid(item)) {
    const [w, h] = footprint(item, catalog);
    for (const other of [...doc.machines, ...doc.decor]) if (other.id !== item.id && solid(other)) {
      const [ow, oh] = footprint(other, catalog);
      if (item.x < other.x + ow && item.x + w > other.x && item.y < other.y + oh && item.y + h > other.y) errors.push(`Overlap: ${item.name} and ${other.name}`);
    }
  }
  return errors;
}

export function floorCell(point: Flat, camera: Projection, doc: FloorDocument): [number, number] {
  const { sinA, cosA, sinE, k } = cameraOf(camera);
  const a = (point[0] - camera.origin[0]) / k;
  const b = (point[1] - camera.origin[1]) / (k * sinE);
  return [Math.floor((sinA * a + cosA * b - doc.origin_x) / cellSize),
    Math.floor((-cosA * a + sinA * b - doc.origin_y) / cellSize)];
}

export function rotationOffset(item: FloorItem, catalog: FloorCatalogItem[]): [number, number] {
  const [w, h] = footprint({ ...item, rotation: 0 }, catalog).map((v) => v * cellSize);
  switch (item.rotation) {
    case 90: return [h, 0];
    case 180: return [w, h];
    case 270: return [0, w];
    default: return [0, 0];
  }
}

export function wallRun(item: LayoutDecor, from: [number, number], to: [number, number]): LayoutDecor {
  const horizontal = Math.abs(to[0] - from[0]) >= Math.abs(to[1] - from[1]);
  return { ...item, x: horizontal ? Math.min(from[0], to[0]) : from[0], y: horizontal ? from[1] : Math.min(from[1], to[1]),
    width: Math.abs(horizontal ? to[0] - from[0] : to[1] - from[1]) + 1, height: 1, rotation: horizontal ? 0 : 90 };
}

export function newItem(entry: FloorCatalogItem, machines: { code: string }[], at: Pick<GridPlacement, "x" | "y">): FloorItem {
  const placement = { id: crypto.randomUUID(), ...at, rotation: 0 as const };
  if (entry.category !== "Machines") return { ...placement, kind: entry.kind, name: entry.label, width: entry.width, height: entry.height };
  const prefix = entry.kind.replace(/[^a-z0-9]/gi, "").slice(0, 20).toUpperCase() || "MACHINE";
  let serial = 1;
  while (machines.some((m) => m.code === `${prefix}-${serial}`)) serial++;
  return { ...placement, code: `${prefix}-${serial}`, name: entry.label, machine_type: entry.kind };
}

export interface DraftState { present: FloorDocument; saved: FloorDocument; revision: number; past: FloorDocument[]; future: FloorDocument[] }
export const startDraft = (layout: FloorLayout): DraftState => ({ present: documentOf(layout), saved: documentOf(layout), revision: layout.revision, past: [], future: [] });
type Action = { type: "commit"; document: FloorDocument } | { type: "saved"; layout: FloorLayout } | { type: "undo" | "redo" | "cancel" };
export function draftReducer(state: DraftState, action: Action): DraftState {
  switch (action.type) {
    case "commit": return sameDocument(state.present, action.document) ? state :
      { ...state, past: [...state.past, state.present], present: action.document, future: [] };
    case "undo": return state.past.length ? { ...state, past: state.past.slice(0, -1), present: state.past.at(-1)!, future: [state.present, ...state.future] } : state;
    case "redo": return state.future.length ? { ...state, past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) } : state;
    case "saved": return { ...state, present: documentOf(action.layout), saved: documentOf(action.layout), revision: action.layout.revision };
    case "cancel": return { ...state, present: state.saved, past: [], future: [] };
  }
}
