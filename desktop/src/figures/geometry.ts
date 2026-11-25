import {
  boxCorners, depthOf, dotsSvg, extrude, fitProjection, iso, pathOf, sideMatrix, slabOf, solidSvg,
  type Flat, type Plane, type Point3, type Projection, type Tone,
} from "../iso/iso-kit";

export const canvas = { width: 1200, height: 610 };
export type Ink = "deck" | "enamel" | "steel" | "rubber" | "kraft" | "glass" | "track" | "screen" | "blue" | "road";

export function roomCamera(width: number, depth: number, height: number) {
  const camera = fitProjection(boxCorners({ x: 0, y: 0, w: width, d: depth, r: 0 }, 0, height),
    canvas.width, canvas.height + 46, { pad: 12, azimuth: 45, elevation: 34 });
  return { ...camera, origin: [camera.origin[0], camera.origin[1] - 46] as Flat };
}

export type GeometryDetail = "full" | "motion";

export function buildWith(camera: Projection, detail: GeometryDetail = "full") {
  function block(x: number, y: number, z: number, width: number, depth: number, height: number,
    ink: Ink = "enamel", tone: Tone = "mid", radius = 2, halo = false) {
    // During orbit, keep the same solid volumes but omit tiny fittings and bevels.
    // Shorter paths reduce both geometry work and browser SVG tessellation.
    const motion = detail === "motion";
    if (motion && (Math.max(width, depth, height) < 10 || height < 1)) return "";
    const solid = slabOf({ x, y, w: width, d: depth, r: motion ? 0 : radius }, z, height, camera, motion ? 0 : 3, motion ? 0 : Math.min(.9, height / 4));
    return solidSvg(solid, { className: `p5-ink p5-${ink}`, tone, halo: halo && !motion, crease: motion ? "none" : "faint" });
  }

  const at = (point: Point3) => iso(point, camera);
  const shape = (points: Point3[]) => pathOf(points.map(at), true);
  const front = (x: number, y: number, z: number) => sideMatrix([x, y], z, camera, "left");
  const position = (point: Point3) => `translate(${at(point).join(" ")})`;
  const bolts = (points: Point3[], radius = .85) => dotsSvg(points.map(at), { size: radius, tone: "hi" });

  function strip(from: Plane, to: Plane, z: number, width: number, height: number, ink: Ink) {
    const span = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const offsetX = (from[1] - to[1]) * width / (2 * span);
    const offsetY = (to[0] - from[0]) * width / (2 * span);
    const plan: Plane[] = [
      [from[0] + offsetX, from[1] + offsetY], [from[0] - offsetX, from[1] - offsetY],
      [to[0] - offsetX, to[1] - offsetY], [to[0] + offsetX, to[1] + offsetY],
    ];
    return solidSvg(extrude(plan, z, height, camera, { convex: true }), { className: `p5-ink p5-${ink}`, tone: "lo", crease: detail === "motion" ? "none" : "faint" });
  }

  function legs(x: number, y: number, w: number, d: number, height: number, width = 6, z = 0) {
    return [[x, y], [x + w - width, y], [x, y + d - width], [x + w - width, y + d - width]]
      .sort((left, right) => depthOf([left[0], left[1], 0], camera) - depthOf([right[0], right[1], 0], camera))
      .map(([left, top]) => block(left, top, z, width, width, height, "steel")).join("");
  }

  return { block, at, shape, front, position, bolts, strip, legs };
}

export const outlineRect = (x: number, y: number, width: number, height: number, className: string, radius = 2) =>
  `<rect class="${className}" x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}"/>`;

export const group = (transform: string, contents: string, attributes = "") =>
  `<g transform="${transform}" ${attributes}>${contents}</g>`;

export function panelScrews(width: number, height: number, inset = 4) {
  return [[inset, inset], [width - inset, inset], [inset, height - inset], [width - inset, height - inset]]
    .map(([x, y]) => `<circle class="p5-screw" cx="${x}" cy="${y}" r="1.15"/>`).join("");
}

export function slots(x: number, y: number, count: number, width: number, gap = 4) {
  return Array.from({ length: count }, (_, index) => outlineRect(x, y + index * gap, width, 1.25, "p5-slot", .6)).join("");
}

export function compareDepth(camera: Projection, position: Point3, other: Point3) {
  return depthOf(position, camera) - depthOf(other, camera);
}

/** Sample a physical route at constant speed across segments of different lengths. */
export function track<T extends Flat | Point3>(points: readonly Point3[], project: (point: Point3) => T) {
  const projected = points.map(project);
  const distances = points.slice(1).map((point, index) => Math.hypot(...point.map((value, axis) => value - points[index][axis])));
  const length = distances.reduce((sum, value) => sum + value, 0);
  return (fraction: number): T => {
    let remaining = Math.max(0, Math.min(1, fraction)) * length;
    for (const [index, distance] of distances.entries()) {
      if (remaining <= distance && distance > 0) {
        return projected[index].map((value, axis) =>
          value + (projected[index + 1][axis] - value) * remaining / distance) as T;
      }
      remaining -= distance;
    }
    return projected[projected.length - 1];
  };
}
