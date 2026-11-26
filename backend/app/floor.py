"""Grid ownership, initial scene and placement invariants shared by floor APIs."""

import math
import uuid

from sqlalchemy import select, text

from app.models import FloorLayout, FloorPlacement, Machine, Routing
from app.schemas.floor import CatalogItem, Decor, LayoutMachine, LayoutOut

CELL = 10
MACHINE_SIZES = {
    "cnc_lathe": (12, 8), "cnc_mill": (12, 9), "laser_cutter": (14, 10),
    "press_brake": (14, 6), "qc_station": (11, 7), "packing": (12, 8),
}
DECOR = [
    CatalogItem(kind=kind, label=label, category=category, width=w, height=h, solid=solid, resizable=resize)
    for kind, label, category, w, h, solid, resize in [
        ("wall", "Wall run", "Structure", 1, 1, True, True),
        ("loading_wing", "Loading wing / dock doors", "Structure", 68, 15, True, False),
        ("office", "Glazed office", "Structure", 12, 13, True, False),
        ("dispatch", "Dispatch bollards", "Structure", 13, 3, True, False),
        ("curb", "Curb", "Structure", 133, 1, False, True),
        ("rack", "Storage rack with cartons", "Furniture", 10, 4, True, False),
        ("pallet", "Loaded pallet", "Furniture", 9, 4, True, False),
        ("table", "Work table", "Furniture", 9, 5, True, False),
        ("chair", "Chair", "Furniture", 3, 3, True, False),
        ("computer", "Computer", "Furniture", 4, 3, True, False),
        ("aisle", "Marked aisle", "Markings", 96, 5, False, True),
        ("crossing", "Pedestrian crossing", "Markings", 14, 4, False, True),
        ("zone", "Bay / zone outline", "Markings", 14, 10, False, True),
        ("road", "Road / apron", "Markings", 133, 8, False, True),
        ("road_mark", "Road marking", "Markings", 5, 1, False, True),
    ]
]


def snap(value: int) -> int:
    # Match JavaScript Math.round, including negative half-cell coordinates.
    return math.floor(value / CELL + .5)


def machine_size(kind: str) -> tuple[int, int]:
    return MACHINE_SIZES.get(kind, (12, 9))


def initial_decor() -> list[Decor]:
    parts = [
        ("rack", 40, 150, 10, 4), ("rack", 40, 200, 10, 4), ("pallet", 40, 280, 9, 4),
        ("office", 60, 500, 12, 13), ("loading_wing", 250, -110, 68, 15),
        ("dispatch", 690, 730, 13, 3), ("curb", -130, 740, 133, 1),
        ("road", -130, 750, 133, 8), ("aisle", 10, 370, 96, 5),
        ("aisle", 170, 20, 4, 64), ("crossing", 30, 370, 14, 4),
    ] + [("road_mark", -110 + 90 * i, 790, 5, 1) for i in range(14)]
    labels = {item.kind: item.label for item in DECOR}
    return [Decor(id=uuid.uuid5(uuid.NAMESPACE_URL, f"factory-floor/{i}"), kind=kind, name=labels[kind],
                  x=snap(x) + 15, y=snap(y) + 17, rotation=0, width=w, height=h)
            for i, (kind, x, y, w, h) in enumerate(parts)]


async def read_layout(session) -> LayoutOut:
    await session.execute(text("SELECT pg_advisory_xact_lock_shared(78301420)"))
    layout = await session.scalar(select(FloorLayout).where(FloorLayout.singleton == 1))
    machines = list(await session.scalars(select(Machine).order_by(Machine.code)))
    kinds = set(MACHINE_SIZES) | {machine.machine_type for machine in machines}
    kinds.update(await session.scalars(select(Routing.machine_type).distinct()))
    catalog = [CatalogItem(kind=kind, label=kind.replace("_", " ").title(), category="Machines",
                           width=machine_size(kind)[0], height=machine_size(kind)[1]) for kind in sorted(kinds)] + DECOR
    if layout:
        by_id = {machine.id: machine for machine in machines}
        placed = [LayoutMachine(id=p.machine_id, code=by_id[p.machine_id].code, name=by_id[p.machine_id].name,
                                machine_type=by_id[p.machine_id].machine_type, x=p.x, y=p.y, rotation=p.rotation)
                  for p in await session.scalars(select(FloorPlacement).order_by(FloorPlacement.machine_id))]
        return LayoutOut(revision=layout.revision, origin_x=layout.origin_x, origin_y=layout.origin_y,
                         columns=layout.columns, rows=layout.rows, machines=placed, decor=layout.decor, catalog=catalog)
    # Until the first save, derive a lossless draft from legacy records; no GET writes data.
    ox = min([-15] + [snap(m.floor_x) for m in machines]) * CELL
    oy = min([-17] + [snap(m.floor_y) for m in machines]) * CELL
    decor = [item.model_copy(update={"x": item.x + (-150 - ox) // CELL,
                                    "y": item.y + (-170 - oy) // CELL}) for item in initial_decor()]
    placed = [LayoutMachine(id=m.id, code=m.code, name=m.name, machine_type=m.machine_type,
                           x=snap(m.floor_x) - ox // CELL, y=snap(m.floor_y) - oy // CELL) for m in machines]
    columns = max([math.ceil((1215 - ox) / CELL)] + [m.x + machine_size(m.machine_type)[0] for m in placed])
    rows = max([math.ceil((845 - oy) / CELL)] + [m.y + machine_size(m.machine_type)[1] for m in placed])
    return LayoutOut(revision=0, origin_x=ox, origin_y=oy, columns=columns, rows=rows,
                     machines=placed, decor=decor, catalog=catalog)


def validate_layout(body) -> list[str]:
    errors, solids, ids, codes = [], [], set(), set()
    catalog = {item.kind: item for item in DECOR}
    for item in [*body.machines, *body.decor]:
        if item.id in ids:
            errors.append("An item ID occurs more than once")
        ids.add(item.id)
        solid = True
        if isinstance(item, LayoutMachine):
            w, h = machine_size(item.machine_type)
            if item.code in codes:
                errors.append(f"Duplicate machine code: {item.code}")
            codes.add(item.code)
        else:
            entry = catalog.get(item.kind)
            if not entry:
                errors.append(f"Unknown decor: {item.kind}")
                continue
            w, h, solid = item.width, item.height, entry.solid
            if not entry.resizable and (w, h) != (entry.width, entry.height):
                errors.append(f"Invalid footprint: {item.name}")
            if item.kind == "wall" and h != 1:
                errors.append("A wall run must be one cell thick")
        if item.rotation in (90, 270):
            w, h = h, w
        if item.x + w > body.columns or item.y + h > body.rows:
            errors.append(f"Outside the floor: {item.name}")
        if solid:
            for other, x, y, width, height in solids:
                if item.x < x + width and item.x + w > x and item.y < y + height and item.y + h > y:
                    errors.append(f"Overlap: {item.name} and {other}")
            solids.append((item.name, item.x, item.y, w, h))
    return errors
