// Building and changing a line design (pure functions, used by the page and tests).
import type { MachineOut } from "../../api/types";
import {
  machineTypeInfo, normalizeMachineType, type BlockKind, type LineBlock, type LineDesign, type LineJob,
} from "./engine";

export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 600;
export const BLOCK_WIDTH = 112;
export const BLOCK_HEIGHT = 64;

export interface SimLineSummary { id: string; name: string; updated_at: string }
export interface SimLineOut extends SimLineSummary { design: LineDesign }

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

/** What a palette entry adds: "source", "sink", or a machine type such as "cnc_lathe". */
export type PaletteItem = "source" | "sink" | string;

export function paletteLabel(item: PaletteItem): string {
  if (item === "source") return "Material in";
  if (item === "sink") return "Ship out";
  return machineTypeInfo(item).label;
}

function nextName(design: LineDesign, base: string): string {
  const used = new Set(design.blocks.map((block) => block.name));
  if (!used.has(base) && (base === "Material in" || base === "Ship out")) return base;
  let number = base === "Material in" || base === "Ship out" ? 2 : 1;
  while (used.has(`${base} ${number}`)) number++;
  return `${base} ${number}`;
}

export function clampPosition(x: number, y: number): { x: number; y: number } {
  const snap = (value: number) => Math.round(value / 10) * 10;
  return {
    x: Math.min(CANVAS_WIDTH - BLOCK_WIDTH / 2, Math.max(BLOCK_WIDTH / 2, snap(x))),
    y: Math.min(CANVAS_HEIGHT - BLOCK_HEIGHT / 2, Math.max(BLOCK_HEIGHT / 2, snap(y))),
  };
}

export function makeBlock(design: LineDesign, item: PaletteItem, x: number, y: number): LineBlock {
  const kind: BlockKind = item === "source" || item === "sink" ? item : "machine";
  const info = kind === "machine" ? machineTypeInfo(item) : null;
  return {
    id: newId(kind),
    kind,
    name: nextName(design, paletteLabel(item)),
    machineType: info?.type ?? "",
    ...clampPosition(x, y),
    cycleSeconds: info?.cycleSeconds ?? 0,
    setupMinutes: info?.setupMinutes ?? 0,
    scrapPercent: 0,
    breakdownsPerDay: 0,
    repairMinutes: 0,
  };
}

function overlapsAny(design: LineDesign, x: number, y: number): boolean {
  return design.blocks.some((block) => Math.abs(block.x - x) < BLOCK_WIDTH && Math.abs(block.y - y) < BLOCK_HEIGHT);
}

/** A free spot for a block added by clicking (not dragging): left to right, top to bottom. */
export function freeSpot(design: LineDesign): { x: number; y: number } {
  for (let y = 100; y < CANVAS_HEIGHT; y += 100) {
    for (let x = 80; x < CANVAS_WIDTH; x += 150) {
      if (!overlapsAny(design, x, y)) return { x, y };
    }
  }
  return { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };
}

export function makeJob(design: LineDesign): LineJob {
  return { id: newId("job"), name: `Job ${design.jobs.length + 1}`, quantity: 100, startHour: 0, dueHour: 24 };
}

export function newDesign(): LineDesign {
  const empty: LineDesign = { blocks: [], links: [], jobs: [] };
  const source = makeBlock(empty, "source", 80, 300);
  const sink = makeBlock({ ...empty, blocks: [source] }, "sink", 880, 300);
  return { blocks: [source, sink], links: [], jobs: [makeJob(empty)] };
}

/** A new line with Material in, every real machine (placed like the factory floor) and Ship out. Links are left to the user. */
export function designFromMachines(machines: MachineOut[]): LineDesign {
  const design = newDesign();
  for (const machine of machines) {
    const type = normalizeMachineType(machine.machine_type);
    let block = makeBlock(design, type, 140 + machine.floor_x * 0.7, 60 + machine.floor_y * 0.7);
    if (overlapsAny(design, block.x, block.y)) block = { ...block, ...freeSpot(design) };
    design.blocks.push({ ...block, name: machine.code });
  }
  return design;
}

export function removeBlock(design: LineDesign, blockId: string): LineDesign {
  return {
    ...design,
    blocks: design.blocks.filter((block) => block.id !== blockId),
    links: design.links.filter((link) => link.from !== blockId && link.to !== blockId),
  };
}

export function updateBlock(design: LineDesign, blockId: string, changes: Partial<LineBlock>): LineDesign {
  return { ...design, blocks: design.blocks.map((block) => block.id === blockId ? { ...block, ...changes } : block) };
}

/** The block under a point, if any (top-most = last drawn). */
export function blockAt(design: LineDesign, x: number, y: number): LineBlock | undefined {
  return [...design.blocks].reverse().find((block) =>
    Math.abs(block.x - x) <= BLOCK_WIDTH / 2 && Math.abs(block.y - y) <= BLOCK_HEIGHT / 2);
}
