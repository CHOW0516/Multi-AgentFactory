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
  return [wrap(Math.round(view.azimuth / 2) * 2), Math.round(view.elevation / 2) * 2] as const;
}

export function floorProjection(azimuth: number, elevation: number): Projection {
  const projection: Projection = { origin: [0, 0], scale: .73, azimuth, elevation };
  const [x, y] = iso(floorCentre, projection);
  return { ...projection, origin: [floorViewport.x - x, floorViewport.y - y] };
}

export function locateInView(view: FloorView, point: Point3, camera: Projection, offset: Pair): FloorView {
  const [x, y] = iso(point, camera);
  const zoom = 1.65;
  return { ...view, zoom, x: (floorViewport.x - x) * zoom + offset[0], y: (floorViewport.y - y) * zoom + offset[1] };
}
