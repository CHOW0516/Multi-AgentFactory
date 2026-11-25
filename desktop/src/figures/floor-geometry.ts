import type { FloorMachine } from "../api/types";
import { boxCorners, depthOf, lineSvg, onTop, topMatrix, type Point3 } from "../iso/iso-kit";
import { buildWith, canvas, group, outlineRect, panelScrews, roomCamera, slots, track } from "./geometry";

export const floorCamera = roomCamera(992, 690, 110);
const floor = buildWith(floorCamera);
const local = buildWith({ ...floorCamera, origin: [0, 0] });
const { block, front, legs, bolts } = local;

export type MachineKind = "cnc_lathe" | "cnc_mill" | "laser_cutter" | "press_brake" | "qc_station" | "packing";
const face = (x: number, y: number, z: number, body: string) => group(front(x, y, z), body);

const windowFrame = (width: number, height: number) =>
  outlineRect(0, 0, width, height, "p5-frame", 2.8) +
  outlineRect(3, 3, width - 6, height - 6, "p5-window", 1.5);

function base(width: number, depth: number, deckHeight = 13) {
  return block(5, 8, 1, width - 10, depth - 8, .5, "rubber", "faint", 4, true) +
    legs(7, 6, width - 14, depth - 12, 7, 8) + block(0, 0, 7, width, depth, deckHeight, "steel", "mid", 3) +
    face(9, depth, 17, slots(0, 0, 2, width - 18, 3));
}

const doors = (width: number, height: number) => outlineRect(0, 0, width, height, "p5-enamel-panel", 2) +
  panelScrews(width, height) + outlineRect(width - 13, height / 2 - 6, 3, 12, "p5-handle", 1.5) +
  lineSvg(`M0 ${height - 8}H${width}`, { tone: "faint" });

const control = (x: number, y: number, z: number) =>
  block(x, y - 7, z - 32, 33, 7, 32, "steel") +
  face(x, y, z, outlineRect(0, 0, 33, 32, "p5-frame", 2) +
    outlineRect(2, 2, 29, 17, "p5-bezel", 1.4) + panelScrews(33, 32, 2.3) +
    Array.from({ length: 8 }, (_, index) => outlineRect(6 + index % 4 * 4.5, 22 + Math.floor(index / 4) * 3, 2.6, 1.8, "p5-key", .4)).join("") +
    '<circle class="p5-key p5-stop" cx="27" cy="25" r="2.7"/>');

const beacon = (x: number, y: number, z: number) => block(x - 3, y - 6, z, 17, 13, 3, "steel") +
  block(x, y, z + 3, 9, 8, 7, "rubber") +
  block(x, y, z + 10, 9, 8, 21, "enamel", "mid", 1) +
  block(x, y, z + 31, 9, 8, 2.5, "steel");

type Art = { body: string; screen: string; light: string; window?: string };
function assemble(body: string, panel: Point3, tower: Point3, opening?: Point3): Art {
  return {
    body: body + control(...panel) + beacon(...tower),
    screen: front(panel[0] + 3, panel[1], panel[2] - 3),
    light: front(tower[0], tower[1] + 8, tower[2] + 31),
    window: opening ? front(...opening) : undefined,
  };
}

const lathe = assemble(base(116, 75) +
  block(0, 3, 20, 113, 69, 61, "enamel", "mid", 5) +
  block(3, 6, 81, 32, 55, 7, "steel") +
  block(92, 9, 81, 16, 40, 4, "steel") +
  face(3, 72, 75, doors(28, 52) + slots(5, 10, 5, 13)) +
  face(33, 72, 73, windowFrame(50, 39) + outlineRect(0, 43, 50, 8, "p5-enamel-panel")) +
  face(85, 72, 75, doors(24, 52)),
  [81, 79, 73], [97, 26, 85], [36, 72, 70]);

const mill = assemble(base(111, 77) +
  block(0, 4, 20, 108, 69, 71, "enamel", "mid", 5) +
  block(20, 13, 91, 45, 40, 5, "steel") +
  block(85, 18, 91, 18, 31, 3, "rubber") +
  face(2, 73, 86, doors(21, 62) + slots(3, 10, 6, 10)) +
  face(25, 73, 82, windowFrame(48, 51) + outlineRect(0, 53, 48, 7, "p5-enamel-panel")) +
  face(75, 73, 86, doors(30, 62)),
  [78, 81, 78], [88, 24, 94], [28, 73, 79]);

const brake = assemble(base(134, 57, 9) +
  block(4, 4, 16, 126, 19, 67, "steel") +
  block(8, 28, 20, 118, 21, 18, "enamel") +
  block(4, 10, 75, 126, 39, 16, "enamel", "mid", 3) +
  block(4, 23, 37, 17, 26, 38, "enamel") +
  block(113, 23, 37, 17, 26, 38, "enamel") +
  face(9, 49, 84, panelScrews(115, 8, 2)) +
  face(23, 49, 73, windowFrame(88, 35)),
  [99, 57, 71], [106, 30, 91], [26, 49, 70]);

const laser = assemble(base(131, 88) +
  block(1, 3, 20, 129, 82, 45, "enamel", "mid", 3) +
  block(5, 7, 65, 113, 61, 8, "steel") +
  block(15, 15, 73, 94, 48, 1, "glass") +
  Array.from({ length: 9 }, (_, index) => block(19 + index * 10, 20, 74, 2, 37, .6, "steel", "lo", .2)).join("") +
  block(15, 17, 74.6, 95, 4, 3, "steel") + block(15, 55, 74.6, 95, 4, 3, "steel") +
  face(5, 85, 60, windowFrame(86, 35)) + face(94, 85, 60, doors(31, 35)),
  [96, 93, 66], [120, 57, 65], [8, 85, 57]);

function bench(width: number, depth: number, top: number, ink: "steel" | "enamel") {
  return legs(3, 3, width - 6, depth - 6, top, 6) +
    block(7, 7, 12, width - 14, depth - 14, 4, "steel", "lo") +
    block(0, 0, top, width, depth, 6, ink, "mid", 2) +
    bolts([[7, 7, top + 6], [width - 7, 7, top + 6], [7, depth - 7, top + 6], [width - 7, depth - 7, top + 6]]);
}

const qc = assemble(bench(110, 70, 37, "steel") +
  block(7, 13, 43, 32, 36, 4, "rubber") +
  block(9, 16, 47, 5, 6, 29, "steel") + block(9, 16, 66, 26, 6, 5, "enamel") +
  block(30, 16, 58, 4, 5, 8, "steel") +
  block(38, 19, 43, 51, 32, 4, "steel") +
  block(72, 22, 47, 11, 8, 27, "steel") + block(56, 22, 74, 27, 8, 7, "enamel") +
  block(56, 23, 60, 6, 6, 14, "steel") + block(50, 33, 47, 23, 12, 5, "kraft"),
  [74, 70, 42], [91, 22, 43]);

function carton(x: number, y: number, z: number, w: number, d: number, h: number) {
  return block(x, y, z, w, d, h, "kraft", "lo", 1) +
    group(topMatrix([x + w / 2 - 2, y], z + h, localCamera), outlineRect(0, 0, 4, d, "p5-tape", 0));
}
const localCamera = { ...floorCamera, origin: [0, 0] as [number, number] };

const packing = assemble(bench(120, 72, 38, "enamel") +
  carton(8, 12, 44, 31, 26, 20) + carton(44, 10, 44, 24, 22, 16) +
  carton(44, 38, 44, 32, 25, 11) + carton(12, 39, 44, 24, 19, 8) +
  block(80, 19, 44, 13, 10, 4, "rubber") + block(83, 20, 48, 6, 8, 8, "steel"),
  [84, 71, 48], [98, 16, 44]);

export const machineArt: Record<MachineKind, Art> = {
  cnc_lathe: lathe, cnc_mill: mill, press_brake: brake, laser_cutter: laser, qc_station: qc, packing,
};

export const genericMachineArt = assemble(base(111, 77) +
  block(1, 4, 20, 108, 69, 54, "enamel", "mid", 4) +
  face(6, 73, 69, doors(63, 45) + slots(8, 12, 4, 32)),
  [78, 81, 69], [90, 23, 74]);

export function kindFor(type: string): MachineKind | undefined {
  return Object.hasOwn(machineArt, type) ? type as MachineKind : undefined;
}

const walk = (x: number, y: number, w: number, d: number, style: string) =>
  `<path class="${style}" d="${onTop([[x, y], [x + w, y], [x + w, y + d], [x, y + d]], .15, floorCamera, true)}"/>`;

const joints = [190, 380, 570, 760].map((x) => walk(x, 0, 1.2, 690, "p5-joint")).join("") +
  [170, 340, 510].map((y) => walk(0, y, 992, 1.2, "p5-joint")).join("");
const aisle = walk(9, 366, 961, 49, "p5-aisle") + walk(9, 366, 961, 2, "p5-mark") + walk(9, 413, 961, 2, "p5-mark") +
  walk(173, 16, 37, 635, "p5-aisle") + walk(173, 16, 2, 635, "p5-mark") + walk(208, 16, 2, 635, "p5-mark") +
  Array.from({ length: 11 }, (_, index) => walk(29 + index * 13, 370, 5, 40, "p5-mark")).join("");
const hallDetails = joints + aisle;
export function floorDeck(machines: FloorMachine[]) {
  const bounds = { x: 0, y: 0, right: 992, bottom: 690 };
  for (const machine of machines) {
    bounds.x = Math.min(bounds.x, machine.floor_x - 15);
    bounds.y = Math.min(bounds.y, machine.floor_y - 15);
    bounds.right = Math.max(bounds.right, machine.floor_x + 149);
    bounds.bottom = Math.max(bounds.bottom, machine.floor_y + 106);
  }
  const { x, y, right, bottom } = bounds;
  const w = right - x;
  const d = bottom - y;
  const art = floor.block(x, y, -12, w, d, 12, "deck", "lo", 7, true) + hallDetails;
  if (x === 0 && y === 0 && right === 992 && bottom === 690) return { art, viewBox: `0 0 ${canvas.width} ${canvas.height}` };
  const projected = boxCorners({ x, y, w, d, r: 0 }, -12, 0).map(floor.at);
  // Include tall bays placed along the expanded deck's back edge.
  projected.push(...machines.map((machine) => floor.at([machine.floor_x + 45, machine.floor_y + 25, 127])));
  const left = Math.min(0, ...projected.map(([flatX]) => flatX - 12));
  const top = Math.min(0, ...projected.map(([, flatY]) => flatY - 12));
  const maxX = Math.max(canvas.width, ...projected.map(([flatX]) => flatX + 12));
  const maxY = Math.max(canvas.height, ...projected.map(([, flatY]) => flatY + 12));
  return { art, viewBox: `${left} ${top} ${maxX - left} ${maxY - top}` };
}

export function bayArt(kind: MachineKind | undefined) {
  const width = kind === "press_brake" || kind === "laser_cutter" ? 139 : 123;
  return `<path class="p5-bay" d="${local.shape([[-7, -7, .2], [width, -7, .2], [width, 97, .2], [-7, 97, .2]])}"/>`;
}

function rack(y: number) {
  const sides = [0, 89].map((x) => block(x, 0, 0, 6, 34, 75, "steel")).join("");
  const shelves = [8, 33, 58].map((z, row) => block(6, 1, z, 83, 33, 4, "steel") +
    [9, 36, 63].map((x, col) => carton(x, 5, z + 4, 20, 25, 11 + (row + col) % 3 * 3)).join("")).join("");
  return group(floor.position([38, y, 0]), sides + shelves);
}
export const storeArt = {
  position: [95, 189, 30] as Point3,
  art: rack(149) + rack(204) + group(floor.position([43, 277, 0]),
    legs(0, 0, 88, 40, 4, 5) + block(0, 0, 4, 88, 40, 4, "kraft") +
    carton(3, 2, 8, 38, 35, 24) + carton(44, 4, 8, 35, 30, 18)),
};

const officeOrigin: Point3 = [57, 502, 0];
const officeDesk = bench(89, 45, 34, "enamel");
export const officeArt = {
  position: [113, 556, 28] as Point3,
  transform: floor.position(officeOrigin),
  base: block(0, 0, 0, 116, 122, 5, "deck") +
    block(0, 0, 5, 116, 5, 56, "glass") + block(0, 5, 5, 5, 115, 56, "glass") +
    block(50, 0, 5, 3, 5, 56, "steel") + block(0, 56, 5, 5, 3, 56, "steel") +
    group(local.position([16, 30, 5]), officeDesk) +
    block(36, 40, 45, 18, 13, 3, "steel") + block(40, 43, 48, 9, 4, 7, "steel") +
    block(26, 41, 55, 39, 7, 24, "steel") + block(34, 57, 45, 37, 9, 2, "rubber") +
    block(86, 86, 5, 15, 13, 21, "steel") + block(79, 80, 26, 29, 24, 5, "rubber"),
  glazing: block(0, 116, 5, 116, 4, 30, "glass") + block(113, 62, 5, 4, 54, 30, "glass") +
    block(0, 116, 35, 117, 4, 2, "steel") + block(113, 62, 35, 4, 54, 2, "steel") +
    block(57, 116, 5, 3, 4, 30, "steel"),
  display: front(29, 48, 76),
};

export const cartArt = legs(-12, -9, 24, 18, 4, 4) + block(-15, -10, 4, 32, 21, 4, "steel") +
  block(13, 6, 8, 3, 4, 14, "steel") + block(13, -7, 8, 3, 4, 14, "steel") +
  block(13, -7, 22, 3, 17, 3, "rubber") + carton(-12, -8, 8, 23, 16, 11);

export function cartTrack(x: number, y: number) {
  const stop = y < 366 ? y + 102 : y - 14;
  return track([[147, 304, 0], [190, 304, 0], [190, 390, 0], [x + 56, 390, 0], [x + 56, stop, 0]], (point): Point3 =>
    [...floor.at(point), depthOf([point[0], point[1], 9], floorCamera)]);
}
