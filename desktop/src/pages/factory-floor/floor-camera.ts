import { iso, type Point3, type Projection } from "../../iso/iso-kit";

export const floorViewport = { width: 1240, height: 720, x: 620, y: 367 };
export const floorCentre: Point3 = [501, 320, 20];
export const initialView = { azimuth: 53, elevation: 38, zoom: 1, x: 0, y: 0 };
export type FloorView = typeof initialView;
type Pair = [number, number];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const wrap = (angle: number) => ((angle % 360) + 360) % 360;

export function orbit(view: FloorView, azimuth: number, elevation = 0): FloorView {
  return { ...view, azimuth: wrap(view.azimuth + azimuth), elevation: clamp(view.elevation + elevation, 23, 70) };
}

export function zoomAt(view: FloorView, ratio: number, [x, y]: Pair = [0, 0]): FloorView {
  const zoom = clamp(view.zoom * ratio, .58, 2.75);
  const change = zoom / view.zoom;
  return { ...view, zoom, x: x + (view.x - x) * change, y: y + (view.y - y) * change };
}

/** Quantise geometry updates during a drag. Zoom and pan only move the SVG group. */
export function projectionAngles(view: FloorView) {
  return [wrap(Math.round(view.azimuth)), Math.round(view.elevation)] as const;
}

export function floorProjection(azimuth: number, elevation: number): Projection {
  const projection: Projection = { origin: [0, 0], scale: .73, azimuth, elevation };
  const [x, y] = iso(floorCentre, projection);
  return { ...projection, origin: [floorViewport.x - x, floorViewport.y - y] };
}

export function locateInView(view: FloorView, point: Point3, camera: Projection, offset: Pair): FloorView {
  const [x, y] = iso(point, camera);
  const zoom = Math.max(1.45, Math.min(view.zoom, 1.85));
  return { ...view, zoom, x: (floorViewport.x - x) * zoom + offset[0], y: (floorViewport.y - y) * zoom + offset[1] };
}

/** Focus in the clear part of a full-size canvas, without cropping it for a panel. */
export function inspectorOffset(scene: SVGSVGElement): Pair {
  const bounds = scene.getBoundingClientRect();
  const workspace = scene.closest(".floor-workspace");
  const inspector = workspace?.querySelector(".floor-inspector")?.getBoundingClientRect();
  if (!inspector || !bounds.width || !bounds.height) return [0, 18];
  const scale = Math.min(bounds.width / floorViewport.width, bounds.height / floorViewport.height);
  const centreX = bounds.left + bounds.width / 2;
  const centreY = bounds.top + bounds.height / 2;
  // A bottom sheet occupies most of the width; otherwise the panel floats right.
  if (inspector.width > bounds.width * .65) {
    const headerBottom = workspace?.querySelector(".floor-overview")?.getBoundingClientRect().bottom ?? bounds.top;
    const targetY = (Math.max(bounds.top, headerBottom) + inspector.top - 12) / 2;
    return [0, (targetY - centreY) / scale + floorViewport.height / 2 - floorViewport.y];
  }
  const targetX = (bounds.left + inspector.left - 12) / 2;
  return [(targetX - centreX) / scale, 18];
}
