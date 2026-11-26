import type { FloorCatalogItem, FloorLayout } from "../../api/types";
import { demoMachines } from "../../figures/demo-events";

const sizes: Record<string, [number, number]> = { cnc_lathe: [12, 8], cnc_mill: [12, 9], laser_cutter: [14, 10], press_brake: [14, 6], qc_station: [11, 7], packing: [12, 8] };
const decor: [string, string, FloorCatalogItem["category"], number, number, boolean, boolean][] = [
  ["wall", "Wall run", "Structure", 1, 1, true, true], ["loading_wing", "Loading wing / dock doors", "Structure", 68, 15, true, false],
  ["office", "Glazed office", "Structure", 12, 13, true, false], ["dispatch", "Dispatch bollards", "Structure", 13, 3, true, false],
  ["curb", "Curb", "Structure", 133, 1, false, true], ["rack", "Storage rack with cartons", "Furniture", 10, 4, true, false],
  ["pallet", "Loaded pallet", "Furniture", 9, 4, true, false], ["table", "Work table", "Furniture", 9, 5, true, false],
  ["chair", "Chair", "Furniture", 3, 3, true, false], ["computer", "Computer", "Furniture", 4, 3, true, false],
  ["aisle", "Marked aisle", "Markings", 96, 5, false, true], ["crossing", "Pedestrian crossing", "Markings", 14, 4, false, true],
  ["zone", "Bay / zone outline", "Markings", 14, 10, false, true], ["road", "Road / apron", "Markings", 133, 8, false, true],
  ["road_mark", "Road marking", "Markings", 5, 1, false, true],
];

export function initialMockLayout(): FloorLayout {
  const catalog: FloorCatalogItem[] = [...new Set([...Object.keys(sizes), ...demoMachines.map((m) => m.machine_type)])].sort().map((kind) => ({
    kind, label: kind.split("_").map((word) => word[0].toUpperCase() + word.slice(1)).join(" "), category: "Machines",
    width: sizes[kind]?.[0] ?? 12, height: sizes[kind]?.[1] ?? 9, solid: true, resizable: false,
  }));
  catalog.push(...decor.map(([kind, label, category, width, height, solid, resizable]) => ({ kind, label, category, width, height, solid, resizable })));
  const parts: [string, number, number, number, number][] = [
    ["rack", 40, 150, 10, 4], ["rack", 40, 200, 10, 4], ["pallet", 40, 280, 9, 4], ["office", 60, 500, 12, 13],
    ["loading_wing", 250, -110, 68, 15], ["dispatch", 690, 730, 13, 3], ["curb", -130, 740, 133, 1],
    ["road", -130, 750, 133, 8], ["aisle", 10, 370, 96, 5], ["aisle", 170, 20, 4, 64], ["crossing", 30, 370, 14, 4],
    ...Array.from({ length: 14 }, (_, i): [string, number, number, number, number] => ["road_mark", -110 + 90 * i, 790, 5, 1]),
  ];
  return { revision: 0, origin_x: -150, origin_y: -170, columns: 137, rows: 102, catalog,
    machines: demoMachines.map(({ id, code, name, machine_type, floor_x, floor_y }) =>
      ({ id, code, name, machine_type, x: Math.round(floor_x / 10) + 15, y: Math.round(floor_y / 10) + 17, rotation: 0 })),
    decor: parts.map(([kind, x, y, width, height], i) => ({ id: `00000000-0000-4000-8001-${String(i + 1).padStart(12, "0")}`,
      kind, name: catalog.find((entry) => entry.kind === kind)!.label, x: x / 10 + 15, y: y / 10 + 17, rotation: 0, width, height })),
  };
}
