import { lineSvg, onTop, type Plane, type Point3, type Projection } from "../iso/iso-kit";
import { buildWith, group, outlineRect, panelScrews, roomCamera, slots, track, type GeometryDetail } from "./geometry";

export const mapCamera = roomCamera(960, 670, 105);
export const stations = ["order", "material", "planning", "quality", "monitoring", "maintenance", "simulator"] as const;
export type Station = typeof stations[number];
export type MapAgent = "orchestrator" | Station;


export function createMapArt(camera: Projection = mapCamera, detail: GeometryDetail = "full") {
  const world = buildWith(camera, detail);
  const local = buildWith({ ...camera, origin: [0, 0] }, detail);
  const { block, front, legs } = local;

  const frontArt = (x: number, y: number, z: number, body: string) => detail === "motion" ? "" : group(front(x, y, z), body);
  const labelPlate = (width: number, height: number) =>
    outlineRect(0, 0, width, height, "p5-frame", 1.7) + panelScrews(width, height, 2.6) +
    lineSvg(`M0 ${height - 2}H${width}`, { tone: "faint" });

  function desk(w: number, d: number, top = 38, ink: "enamel" | "steel" = "enamel") {
    return legs(4, 4, w - 8, d - 8, top, 6) + block(9, 7, 9, w - 18, 6, 5, "steel") +
      block(0, 0, top, w, d, 5, ink, "mid", 2);
  }

  function screen(x: number, y: number, base: number, w: number, h: number, picture: string) {
    return block(x + w * .36, y + 2, base, w * .28, 11, 2, "rubber") +
      block(x + w * .45, y + 2, base + 2, w * .1, 5, 7, "steel") + block(x, y, base + 9, w, 7, h, "steel") +
      frontArt(x, y + 7, base + 9 + h, outlineRect(0, 0, w, h, "p5-frame") +
        outlineRect(2, 2, w - 4, h - 4, "p5-display", 1) + picture);
  }

  const wave = '<path class="p5-screen-wave" d="M4 17h5l3-6 4 8 4-11 4 7h7v1h-8l-3-5-4 11-4-9-2 5H4z"/>';
  const activity = '<path class="p5-screen-wave" d="M5 18h5v-4H5zm8 0h5v-8h-5zm8 0h5V7h-5zm8 0h5V5h-5z"/>';
  const cells = '<path class="p5-screen-wave" d="M5 7h9v2H5zm12 0h14v2H17zM5 12h15v2H5zm0 5h21v2H5z"/>';

  const vault = block(16, 44, 0, 55, 26, 34, "steel") + frontArt(16, 70, 34,
    labelPlate(55, 34) + outlineRect(5, 5, 45, 24, "p5-enamel-panel") + slots(10, 10, 4, 17, 4) +
    '<circle class="p5-frame" cx="37" cy="17" r="7"/><path class="p5-tool" d="M36 12h2v10h-2zM32 16h10v2H32z"/>' +
    outlineRect(47, 10, 4, 5, "p5-handle", 1) + outlineRect(47, 20, 4, 5, "p5-handle", 1));

  const consoleArt = vault + block(112, 23, 0, 29, 43, 40, "steel") +
    block(6, 6, 0, 9, 61, 40, "steel") + block(0, 0, 40, 148, 73, 6, "steel", "mid", 3) +
    screen(9, 13, 46, 38, 24, cells) + screen(53, 11, 46, 42, 27, activity) +
    screen(101, 13, 46, 37, 24, wave) +
    [15, 59, 103].map((x) => block(x, 44, 46, 28, 12, 2, "rubber") + block(x + 30, 47, 46, 5, 7, 2, "steel")).join("") +
    frontArt(13, 73, 46, panelScrews(125, 5, 1.5));

  const paper = (x: number, y: number, z: number, w: number, d: number) => block(x, y, z, w, d, 1.2, "enamel", "lo", 1);
  const orderArt = desk(116, 59) +
    block(5, 12, 43, 49, 36, 7, "steel") + block(7, 14, 50, 45, 32, 3, "rubber") +
    block(10, 15, 53, 39, 28, 3, "enamel") + frontArt(10, 43, 56, slots(4, 1.4, 1, 29)) +
    block(64, 9, 43, 45, 37, 3, "steel") + block(64, 9, 46, 43, 3, 9, "steel") +
    block(64, 12, 46, 3, 33, 7, "steel") + block(106, 12, 46, 3, 33, 7, "steel") +
    paper(70, 15, 46, 32, 27) + paper(73, 17, 47.2, 26, 24) +
    block(33, 9, 56, 19, 7, 6, "steel");

  function bin(x: number, y: number, z: number, width: number) {
    return block(x, y, z, width, 25, 13, "kraft", "mid") +
      frontArt(x + 4, y + 25, z + 10, outlineRect(0, 0, width - 8, 3, "p5-frame", .6));
  }
  const materialArt = block(0, 3, 0, 117, 42, 5, "steel") +
    block(0, 2, 5, 5, 42, 68, "steel") + block(112, 2, 5, 5, 42, 68, "steel") +
    [5, 28, 51].map((z) => block(5, 3, z, 107, 42, 4, "steel") +
      [9, 43, 77].map((x) => bin(x, 12, z + 4, 28)).join("")).join("") +
    block(11, 55, 0, 97, 27, 18, "enamel") + block(21, 57, 18, 33, 22, 3, "steel") +
    block(67, 60, 18, 23, 16, 7, "steel") + frontArt(70, 76, 23, outlineRect(0, 0, 16, 3.5, "p5-display", .8));

  const gantt = outlineRect(0, 0, 76, 37, "p5-window") + panelScrews(76, 37, 3) +
    '<path class="p5-gantt-grid" d="M8 6h60v.6H8zm0 7h60v.6H8zm0 7h60v.6H8zm0 7h60v.6H8zm0 7h60v.6H8zM8 6h.6v28H8zm15 0h.6v28H23zm15 0h.6v28H38zm15 0h.6v28H53zm15 0h.6v28H68z"/>' +
    '<path class="p5-screen-wave" d="M11 9h20v3H11zm15 7h20v3H26zm14 7h19v3H40zm3 7h23v3H43z"/>';
  const planningArt = desk(119, 65) +
    block(10, 10, 43, 4, 6, 37, "steel") + block(91, 10, 43, 4, 6, 37, "steel") +
    block(14, 9, 46, 77, 7, 37, "steel") + frontArt(14, 16, 83, gantt) +
    block(12, 28, 43, 82, 28, 4, "steel") + paper(20, 34, 47, 64, 22) +
    block(17, 31, 48.2, 75, 4, 3, "rubber") + block(45, 31, 51.2, 15, 4, 3, "steel");

  const qualityArt = desk(112, 66, 38, "steel") +
    block(10, 14, 43, 87, 41, 4, "rubber") +
    block(15, 16, 47, 20, 18, 3, "steel") + block(18, 18, 50, 6, 6, 27, "steel") +
    block(24, 18, 69, 38, 6, 6, "enamel") + block(56, 18, 58, 5, 6, 17, "steel") +
    block(48, 28, 47, 23, 12, 6, "kraft") + block(82, 39, 47, 12, 9, 6, "steel") +
    block(75, 12, 47, 23, 13, 5, "steel") + frontArt(77, 25, 51, outlineRect(0, 0, 18, 3, "p5-display", .8));

  const monitoringArt = desk(125, 61) +
    block(5, 9, 43, 115, 9, 53, "steel") +
    [0, 1, 2].map((column) => [0, 1].map((row) =>
      frontArt(8 + column * 37, 18, 93 - row * 24,
        outlineRect(0, 0, 34, 21, "p5-frame") + outlineRect(2, 2, 30, 17, "p5-display", 1) +
        group("translate(1 0) scale(.8)", [wave, activity, cells][(row + column) % 3]))).join("")).join("") +
    block(17, 34, 43, 55, 18, 2, "rubber") + block(84, 33, 43, 26, 16, 3, "steel");

  const maintenanceArt = block(4, 3, 0, 108, 58, 6, "rubber") +
    block(0, 0, 6, 116, 60, 43, "steel") +
    [0, 1, 2].map((row) => frontArt(3, 60, 46 - row * 12,
      labelPlate(109, 10) + outlineRect(42, 3, 25, 3.3, "p5-handle", 1))).join("") +
    block(0, 0, 49, 116, 62, 4, "enamel") + block(6, 4, 53, 103, 6, 33, "steel") +
    frontArt(6, 10, 86, labelPlate(103, 33) +
      '<path class="p5-tool" d="M14 7h4v7h4v4h-4v10h-4V18h-4v-4h4zm23 0h5v18h-5zm18 3h13v6H55zm5 6h3v12h-3zm26-8h4v19h-4z"/>') +
    block(78, 33, 53, 26, 15, 6, "rubber");

  const simulatorArt = desk(108, 58) +
    block(47, 15, 43, 50, 34, 30, "steel") + frontArt(48, 49, 72, labelPlate(48, 28) + slots(8, 6, 4, 30, 4)) +
    screen(5, 16, 43, 36, 25, wave) + block(7, 33, 43, 34, 13, 2, "rubber");

  const stationInfo: Record<MapAgent, { label: string; position: Plane; body: string; width: number; depth: number; height: number }> = {
    orchestrator: { label: "Orchestrator", position: [410, 304], body: consoleArt, width: 148, depth: 73, height: 40 },
    order: { label: "Order", position: [304, 49], body: orderArt, width: 116, depth: 59, height: 38 },
    material: { label: "Material", position: [55, 192], body: materialArt, width: 117, depth: 82, height: 16 },
    planning: { label: "Planning", position: [640, 53], body: planningArt, width: 119, depth: 65, height: 38 },
    quality: { label: "Quality", position: [788, 230], body: qualityArt, width: 112, depth: 66, height: 38 },
    monitoring: { label: "Monitoring", position: [731, 521], body: monitoringArt, width: 125, depth: 61, height: 38 },
    maintenance: { label: "Maintenance", position: [363, 545], body: maintenanceArt, width: 116, depth: 62, height: 44 },
    simulator: { label: "Simulator", position: [66, 473], body: simulatorArt, width: 108, depth: 58, height: 38 },
  };

  const stationArt = Object.fromEntries(Object.entries(stationInfo).map(([name, station]) => {
    const [x, y] = station.position;
    return [name, { ...station, transform: world.position([x, y, 0]), plate: front(7, station.depth, station.height),
      depthPoint: [x + station.width / 2, y + station.depth / 2, 30] as Point3 }];
  })) as Record<MapAgent, (typeof stationInfo)[MapAgent] & { transform: string; plate: string; depthPoint: Point3 }>;

  const ringZ = 4;
  const routeHeight = 10;
  const routes: Record<Station, Plane[]> = {
    order: [[434, 302], [434, 159], [360, 159], [360, 109]],
    material: [[408, 325], [284, 325], [284, 222], [220, 222], [174, 222]],
    planning: [[519, 302], [519, 159], [693, 159], [693, 117]],
    quality: [[561, 323], [622, 323], [622, 259], [752, 259], [787, 259]],
    monitoring: [[558, 369], [627, 369], [627, 478], [752, 478], [752, 520]],
    maintenance: [[453, 378], [453, 478], [411, 478], [411, 544]],
    simulator: [[408, 364], [330, 364], [330, 478], [220, 478], [175, 478]],
  };

  function segment(from: Plane, to: Plane) {
    const span = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const unit: Plane = [(to[0] - from[0]) / span, (to[1] - from[1]) / span];
    const edge: Plane = [-unit[1], unit[0]];
    const at = (distance: number, side = 0): Plane => [from[0] + unit[0] * distance + edge[0] * side, from[1] + unit[1] * distance + edge[1] * side];
    const rails = [-7, 7].map((side) => world.strip(at(0, side), at(span, side), 8, 2, 1.8, "steel")).join("");
    const supportCount = detail === "motion" ? 1 : Math.max(1, Math.ceil(span / 66));
    const supports = Array.from({ length: supportCount }, (_, index) => {
      const distance = (index + .5) * span / supportCount;
      const [x, y] = at(distance);
      return world.block(x - 3, y - 3, 0, 6, 6, ringZ, "steel", "lo", 1);
    }).join("");
    return supports + world.strip(from, to, ringZ, 16, 3, "track") + rails;
  }

  function spurArt(path: Plane[]) {
    return path.slice(1).map((point, index) => segment(path[index], point)).join("") +
      path.map(([x, y], index) => world.block(x - 7, y - 7, 4, 14, 14, index === 0 || index === path.length - 1 ? 6 : 4, "steel", "lo", 2)).join("");
  }

  const railArt = Object.fromEntries(stations.map((name) => {
    const route = routes[name];
    const routePoints: Point3[] = route.map(([x, y]) => [x, y, routeHeight]);
    const hit = route.slice(1).map((point, index) => {
      const a = world.at([...route[index], routeHeight]);
      const b = world.at([...point, routeHeight]);
      return `M${a.join(" ")}L${b.join(" ")}`;
    }).join("");
    return [name, { art: spurArt(route), hit, sample: track(routePoints, world.at) }];
  })) as Record<Station, { art: string; hit: string; sample: (position: number) => [number, number] }>;

  const joints = [170, 335, 500].map((y) =>
    `<path class="p5-joint" d="${onTop([[0, y], [960, y], [960, y + 1.5], [0, y + 1.5]], .1, camera, true)}"/>`).join("");

  const roomArt = world.block(0, 0, -13, 960, 670, 13, "deck", "lo", 10, true) + joints;

  function ducts(names: Station[]) {
    return names.map((name) => {
      const path = routes[name].map(([x, y]): Point3 => [x + 8, y + 10, .3]);
      const elbows = path.slice(1).map(([x, y], index) =>
        world.strip([path[index][0], path[index][1]], [x, y], .25, 3.5, 1, "rubber")).join("");
      const [x, y] = path[path.length - 1];
      return elbows + world.block(x - 3, y - 3, 0, 6, 6, 3, "steel", "mid", 1);
    }).join("");
  }

  return { stationArt, railArt, roomArt, ducts };
}

export const { stationArt, railArt, roomArt, ducts } = createMapArt();
