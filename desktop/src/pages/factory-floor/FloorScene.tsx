import { memo, useEffect, useId, useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { FloorDocument, FloorCatalogItem, FloorMachine, LayoutDecor } from "../../api/types";
import { depthOf, type Point3 } from "../../iso/iso-kit";
import { activateOnKey } from "../../figures/figure-ui";
import { floorArt, kindFor } from "../../figures/floor-geometry";
import { compareDepth } from "../../figures/geometry";
import { useFigureFrames, useMotionVisibility } from "../../figures/motion";
import { CameraControls } from "../../figures/CameraControls";
import { floorProjection, floorViewport, inspectorOffset, locateInView, projectionAngles } from "./floor-camera";
import { mechanismTransform, statusNames } from "./model";
import { useFloorCamera } from "./use-floor-camera";
import { floorCell, footprint, isMachine, rotationOffset, type FloorItem } from "./editor-model";

function Display({ transform, line, detail, width = 27, height = 15 }: {
  transform: string; line: string; detail: string; width?: number; height?: number;
}) {
  const clip = useId();
  return <g transform={transform} aria-hidden="true">
    <clipPath id={clip}><rect width={width} height={height} rx="1" /></clipPath>
    <g clipPath={`url(#${clip})`}>
      <rect className="p5-display" width={width} height={height} />
      <text className="p5-display-text" x="2" y={height * .4} fontSize={width / Math.max(7, line.length * .68)}>{line}</text>
      <text className="p5-display-text p5-display-secondary" x="2" y={height * .82} fontSize={width / Math.max(8, detail.length * .65)}>{detail}</text>
    </g>
  </g>;
}

function placeCart(cart: SVGGElement, layer: SVGGElement, pose: [number, number, number], opacity: number) {
  const [x, y, depth] = pose;
  const next = Array.from(layer.children).find((part) =>
    part.hasAttribute("data-depth") && Number(part.getAttribute("data-depth")) >= depth) ?? null;
  if (cart.parentNode !== layer || cart.nextElementSibling !== next) layer.insertBefore(cart, next);
  cart.setAttribute("transform", `translate(${x} ${y})`);
  cart.setAttribute("opacity", String(opacity));
}

function Mechanism({ kind, transform }: { kind: string; transform: string }) {
  const clip = useId();
  const [width, height] = kind === "cnc_lathe" ? [44, 33] : kind === "cnc_mill" ? [42, 45] : kind === "press_brake" ? [82, 29] : [80, 29];
  return <g transform={transform} aria-hidden="true">
    <clipPath id={clip}><rect width={width} height={height} rx="1.5" /></clipPath>
    <g clipPath={`url(#${clip})`}>
      {kind === "cnc_lathe" && <>
        <path className="p5-interior" d="M2 31h40v-5H2zm15-16h19v4H17z" />
        <g data-mechanism=""><circle className="p5-interior" cx="13" cy="15" r="9" />
          <path className="p5-tool" d="M11 7h4v6h-4zm5 11 4 3-3 3-4-4zm-7-1 2 3-5 4-2-3z" /></g>
        <path className="p5-tool" d="M34 20h8v7H29v-4z" />
      </>}
      {kind === "cnc_mill" && <>
        <path className="p5-interior" d="M5 38h32v7H5zm7-4h19v4H12z" />
        <g data-mechanism=""><path className="p5-interior" d="M10-10h22v22H10z" /><path className="p5-tool" d="M17 11h8v7h-2v6h-4v-6h-2z" /></g>
      </>}
      {kind === "press_brake" && <>
        <path className="p5-interior" d="M2 25h78v4H2z" /><path className="p5-tool" d="M10 22h62v3H10z" />
        <g data-mechanism=""><path className="p5-interior" d="M3-13h76V7H3z" /><path className="p5-tool" d="M8 7h66v3H8z" /></g>
      </>}
      {kind === "laser_cutter" && <>
        <path className="p5-interior" d="M1 18h78v3H1zm4 5h70v5H5z" />
        <g data-mechanism=""><path className="p5-tool" d="M10 2h12v9h-3v5h-6v-5h-3z" /><path className="p5-laser" d="M15 15h2v7h-2z" /></g>
      </>}
    </g>
  </g>;
}

const Machine = memo(function Machine({ machine, active, onInspect, onHover, art, position, interactive = true, hitPath }: {
  machine: FloorMachine; active: boolean; onInspect: (id: string) => void; onHover: (id: string | null) => void;
  art: ReturnType<typeof floorArt>;
  position?: string;
  interactive?: boolean;
  hitPath?: string;
}) {
  const kind = kindFor(machine.machine_type);
  const model = kind ? art.machineArt[kind] : art.genericMachineArt;
  const select = () => onInspect(machine.id);
  return <g transform={position ?? art.floor.position([machine.floor_x, machine.floor_y, 0])} data-floor-item={machine.id}
    className="p5-scene-target p5-machine" data-machine={machine.id} data-kind={kind ?? "generic"} data-status={machine.status}
    data-tooltip={`${machine.code} · ${machine.current_order_number ?? "No current order"} · ${machine.part_count} parts`}
    data-active={active || undefined} role={interactive ? "button" : undefined} tabIndex={interactive ? 0 : undefined} aria-hidden={!interactive || undefined} aria-label={`${machine.name}, ${statusNames[machine.status]}`}
    onClick={select} onKeyDown={(event) => activateOnKey(event, select)} onPointerEnter={() => onHover(machine.id)}
    onPointerLeave={() => onHover(null)} onFocus={() => onHover(machine.id)} onBlur={() => onHover(null)}>
    {hitPath && <path d={hitPath} fill="transparent" />}
    <g dangerouslySetInnerHTML={{ __html: model.body }} />
    {art.showFront && model.window && kind ? <Mechanism kind={kind} transform={model.window} /> : null}
    {art.showFront && <Display transform={model.screen} line={machine.current_order_number ?? "STANDBY"} detail={`${machine.part_count} PCS`} />}
    <g data-stack-light="" data-status={machine.status} className="p5-beacon" aria-hidden="true">
      {model.lenses.map(({ transform, width }, index) => <g key={index} transform={transform}>
        {[0, 4.2, 8.4, 12.6, 16.8].map((top) => <rect key={top} className="p5-beacon-off" x="0" y={top} width={width} height="4" />)}
        <rect className="p5-beacon-on" x="0" y="0" width={width} height="4.1" />
      </g>)}
    </g>
  </g>;
});

export type CartArrival = { id: string; x: number; y: number };
export type FocusRequest = { id: string };

export interface FloorSceneEditing {
  selected: string | null;
  ghost: FloorItem | null;
  valid: boolean;
  cursor: [number, number];
  disabled: boolean;
  onDown(cell: [number, number], id?: string): void;
  onMove(cell: [number, number]): void;
  onUp(cell: [number, number]): void;
  onDrop(cell: [number, number]): void;
  onCancel(): void;
  onKeyDown(event: KeyboardEvent<SVGSVGElement>): void;
}

export function FloorScene({ machines, approvals, active, onInspect, onHover, arrival, focus, inspecting = false, layout, editor }: {
  machines: FloorMachine[]; approvals: number; active: string | null; onInspect: (id: string) => void;
  onHover: (id: string | null) => void; arrival: CartArrival | null; focus?: FocusRequest | null; inspecting?: boolean;
  layout?: FloorDocument & { catalog?: FloorCatalogItem[] }; editor?: FloorSceneEditing;
}) {
  const hint = useId();
  const scene = useRef<SVGSVGElement>(null);
  const world = useRef<SVGGElement>(null);
  const editingPointer = useRef<number | null>(null);
  const skipEditorClick = useRef(false);
  const fixtures = useRef<SVGGElement>(null);
  const cart = useRef<SVGGElement | null>(null);
  const activeCart = useRef({ id: "", began: 0 });
  const cartProgress = useRef(0);
  const lastFocus = useRef<FocusRequest | null>(null);
  const runningMechanisms = useRef<{ node: SVGGElement; kind: string }[]>([]);
  const { visible, reduced } = useMotionVisibility(scene);
  const controls = useFloorCamera(scene);
  const { view } = controls;
  const [azimuth, elevation] = projectionAngles(view);
  const camera = useMemo(() => floorProjection(azimuth, elevation), [azimuth, elevation]);
  const art = useMemo(() => floorArt(camera, controls.lowDetail ? "motion" : "full"), [camera, controls.lowDetail]);
  const route = useMemo(() => arrival && art.cartTrack(arrival.x, arrival.y), [arrival, art]);
  const deck = useMemo(() => art.floorDeck(machines, layout), [art, machines, layout]);
  const catalog = layout?.catalog ?? [];
  const rotationKey = [...new Set([0, ...machines.map((m) => m.rotation ?? 0), ...(layout?.decor ?? []).map((d) => d.rotation), editor?.ghost?.rotation ?? 0])].sort().join(",");
  const rotatedArt = useMemo(() => new Map(rotationKey.split(",").map(Number).map((rotation) => [rotation,
    rotation === 0 ? art : floorArt({ ...camera, azimuth: (camera.azimuth ?? 45) - rotation }, controls.lowDetail ? "motion" : "full")
  ])), [art, camera, rotationKey, controls.lowDetail]);
  const itemPosition = (item: FloorItem) => {
    const [dx, dy] = rotationOffset(item, catalog);
    return art.floor.position([layout!.origin_x + item.x * 10 + dx, layout!.origin_y + item.y * 10 + dy, 0]);
  };
  const asItem = (machine: FloorMachine): FloorItem => ({ ...machine, x: (machine.floor_x - (layout?.origin_x ?? 0)) / 10,
    y: (machine.floor_y - (layout?.origin_y ?? 0)) / 10, rotation: (machine.rotation ?? 0) as FloorItem["rotation"] });
  const cellAt = (event: { clientX: number; clientY: number }): [number, number] | null => {
    const matrix = world.current?.getScreenCTM();
    if (!matrix || !layout) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return floorCell([point.x, point.y], camera, layout);
  };
  const pointerEnd = (event: PointerEvent<SVGSVGElement>, cancel = false) => {
    if (editingPointer.current === event.pointerId && editor) {
      editingPointer.current = null;
      const cell = cellAt(event);
      if (cancel || !cell) editor.onCancel(); else editor.onUp(cell);
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    } else controls.handlers.onPointerUp(event);
  };
  const footprintPath = (item: FloorItem) => {
    const [w, h] = footprint(item, catalog);
    const x = layout!.origin_x + item.x * 10, y = layout!.origin_y + item.y * 10;
    return art.floor.shape([[x, y, .6], [x + w * 10, y, .6], [x + w * 10, y + h * 10, .6], [x, y + h * 10, .6]]);
  };
  const renderDecor = (item: LayoutDecor, ghost = false) => <g key={item.id} data-floor-item={item.id}
    transform={itemPosition(item)} data-ghost={ghost || undefined}
    role={editor && !ghost ? "button" : undefined} tabIndex={editor && !ghost ? 0 : undefined}
    aria-label={editor && !ghost ? item.name : undefined} aria-hidden={!editor || ghost || undefined}
    onClick={editor && !ghost ? () => onInspect(item.id) : undefined}
    onKeyDown={editor && !ghost ? (event) => activateOnKey(event, () => onInspect(item.id)) : undefined}
    className={editor ? "floor-decor-target" : undefined}>
    {editor && <path d={rotatedArt.get(item.rotation)!.itemPlane(item.width, item.height)} fill="transparent" />}
    <g dangerouslySetInnerHTML={{ __html: rotatedArt.get(item.rotation)!.decorArt(item.kind, item.width, item.height) }} />
  </g>;
  const selected = machines.find((machine) => machine.id === active);

  useEffect(() => {
    if (!focus || focus === lastFocus.current || !scene.current) return;
    const machine = machines.find((entry) => entry.id === focus.id);
    if (!machine) return;
    lastFocus.current = focus;
    const offset = inspecting ? inspectorOffset(scene.current) : [0, 18] as [number, number];
    controls.animate(locateInView(view, [machine.floor_x + 55, machine.floor_y + 39, 47], camera, offset));
  }, [focus, camera, controls, inspecting, machines, view]);

  useEffect(() => {
    const layer = fixtures.current;
    if (!route || !layer) return;
    // Keep the cart outside React's child order so it can pass behind the stationary fixtures.
    const part = document.createElementNS("http://www.w3.org/2000/svg", "g");
    part.setAttribute("aria-hidden", "true");
    part.setAttribute("pointer-events", "none");
    part.setAttribute("data-cart", "");
    part.innerHTML = art.cartArt;
    cart.current = part;
    const progress = activeCart.current.id === arrival?.id ? cartProgress.current : 0;
    placeCart(part, layer, route(reduced ? 1 : progress), reduced ? .95 : cartOpacity(progress));
    return () => {
      part.remove();
      cart.current = null;
    };
  }, [arrival?.id, art, route, reduced]);

  useEffect(() => {
    runningMechanisms.current = Array.from(scene.current?.querySelectorAll<SVGGElement>("[data-mechanism]") ?? []).flatMap((node) => {
      const host = node.closest("[data-kind]");
      if (host?.getAttribute("data-status") === "running") return [{ node, kind: host.getAttribute("data-kind") ?? "" }];
      node.removeAttribute("transform");
      return [];
    });
  }, [machines, art]);

  useFigureFrames(visible && !reduced && !controls.lowDetail && (Boolean(route) || machines.some((machine) => machine.status === "running")),
    (time) => {
      for (const mechanism of runningMechanisms.current) mechanism.node.setAttribute("transform", mechanismTransform(mechanism.kind, time));
      if (route && arrival && cart.current && fixtures.current) {
        if (activeCart.current.id !== arrival.id) activeCart.current = { id: arrival.id, began: time };
        const progress = (time - activeCart.current.began) / 4000;
        if (cartProgress.current < 1.2 || progress < 1.2) {
          placeCart(cart.current, fixtures.current, route(progress), cartOpacity(progress));
        }
        cartProgress.current = progress;
      }
    });

  const sorted = [
    ...machines.map((machine) => ({ type: "machine" as const, position: [machine.floor_x + 52, machine.floor_y + 40, 22] as Point3, machine })),
    ...(layout ? layout.decor.map((item) => { const [w, h] = footprint(item, catalog); return { type: "decor" as const,
      position: [layout.origin_x + (item.x + w / 2) * 10, layout.origin_y + (item.y + h / 2) * 10, 15] as Point3, item }; }) : [
      { type: "store" as const, position: art.storeArt.position },
      { type: "office" as const, position: art.officeArt.position },
      ...art.yard.map((item) => ({ type: "yard" as const, position: item.depth, item })),
    ]),
  ].sort((left, right) => compareDepth(camera, left.position, right.position));
  const matrix = `translate(${floorViewport.x + view.x} ${floorViewport.y + view.y}) scale(${view.zoom}) translate(${-floorViewport.x} ${-floorViewport.y})`;
  const selectedKind = selected && kindFor(selected.machine_type);
  const markerArt = selectedKind ? art.machineArt[selectedKind] : art.genericMachineArt;
  const marker = selected && art.floor.at([selected.floor_x + 48, selected.floor_y + 34, markerArt.markerHeight]);

  return <>
    <span className="sr-only" id={hint}>{editor ? "Click a palette item then a cell, or drag it onto the floor. Drag items to move. Arrows move the grid cursor; Enter places or moves the selected item. R rotates, Delete removes. Right-drag pans; scroll zooms." : "Drag to orbit. Hold right click and drag to pan. Scroll or pinch to zoom. On the keyboard, use the arrows, plus, minus, and Home."}</span>
    <div className="floor-viewport" data-moving={controls.moving || undefined}>
      <svg ref={scene} className="iso-svg p5-scene floor-model" data-animate={visible && !reduced || undefined}
        data-detail={controls.lowDetail ? "motion" : "full"}
        data-azimuth={azimuth} data-elevation={elevation} data-zoom={view.zoom.toFixed(2)}
        viewBox={`0 0 ${floorViewport.width} ${floorViewport.height}`} aria-label="Interactive isometric factory floor"
        aria-describedby={hint} role="group" tabIndex={0}
        {...controls.handlers}
        onPointerDown={(event) => {
          if (!editor || event.button !== 0) { controls.handlers.onPointerDown(event); return; }
          if (editor.disabled) return;
          const cell = cellAt(event);
          if (!cell) return;
          event.preventDefault();
          event.currentTarget.focus();
          editingPointer.current = event.pointerId;
          skipEditorClick.current = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          editor.onDown(cell, (event.target as Element).closest("[data-floor-item]")?.getAttribute("data-floor-item") ?? undefined);
        }}
        onPointerMove={(event) => {
          controls.handlers.onPointerMove(event);
          const cell = cellAt(event);
          if (editor && !editor.disabled && cell) editor.onMove(cell);
        }}
        onPointerUp={(event) => pointerEnd(event)} onPointerCancel={(event) => pointerEnd(event, true)}
        onLostPointerCapture={(event) => { if (editingPointer.current === event.pointerId) pointerEnd(event, true); else controls.handlers.onLostPointerCapture(event); }}
        onKeyDown={(event) => { if (editor && !event.altKey) editor.onKeyDown(event); else controls.handlers.onKeyDown(event); }}
        onDragOver={(event) => { if (editor && !editor.disabled) { event.preventDefault(); const cell = cellAt(event); if (cell) editor.onMove(cell); } }}
        onDrop={(event) => { if (editor && !editor.disabled) { event.preventDefault(); const cell = cellAt(event); if (cell) editor.onDrop(cell); } }}
        onClickCapture={(event) => {
          if (editor && skipEditorClick.current && event.detail !== 0) { event.stopPropagation(); skipEditorClick.current = false; return; }
          if (!controls.moved.current || event.detail === 0) return;
          event.stopPropagation();
          controls.moved.current = false;
        }}>
        <g ref={world} transform={matrix}>
          <g dangerouslySetInnerHTML={{ __html: deck }} aria-hidden="true" />
          {editor && layout && <path className="floor-edit-grid" aria-hidden="true" d={
            Array.from({ length: layout.columns + 1 }, (_, i) => { const x = layout.origin_x + i * 10;
              return `M${art.floor.at([x, layout.origin_y, .2]).join(" ")}L${art.floor.at([x, layout.origin_y + layout.rows * 10, .2]).join(" ")}`; }).join("") +
            Array.from({ length: layout.rows + 1 }, (_, i) => { const y = layout.origin_y + i * 10;
              return `M${art.floor.at([layout.origin_x, y, .2]).join(" ")}L${art.floor.at([layout.origin_x + layout.columns * 10, y, .2]).join(" ")}`; }).join("")
          } />}
          {machines.map((machine) => layout ? <g key={machine.id} data-bay-active={active === machine.id || undefined} aria-hidden="true">
            <path className="p5-bay" d={footprintPath(asItem(machine))} />
          </g> : <g key={machine.id} transform={art.floor.position([machine.floor_x, machine.floor_y, 0])}
            data-bay-active={active === machine.id || undefined}
            dangerouslySetInnerHTML={{ __html: art.bayArt(kindFor(machine.machine_type)) }} aria-hidden="true" />)}
          <g ref={fixtures}>
            {sorted.map((item) => {
              const depth = depthOf(item.position, camera);
              if (item.type === "decor") return editor?.ghost?.id === item.item.id ? null : <g key={item.item.id} data-depth={depth}>{renderDecor(item.item)}</g>;
              if (item.type === "yard") return <g key={item.item.id} data-depth={depth} transform={art.floor.position(item.item.at)}
                dangerouslySetInnerHTML={{ __html: item.item.body }} aria-hidden="true" />;
              if (item.type === "store") return <g key="store" data-depth={depth} dangerouslySetInnerHTML={{ __html: art.storeArt.art }} aria-hidden="true" />;
              if (item.type === "office") return <g key="office" data-depth={depth} transform={art.officeArt.transform} aria-hidden="true">
                <g dangerouslySetInnerHTML={{ __html: art.officeArt.base }} />
                {art.showFront && <Display transform={art.officeArt.display} line={String(approvals)} detail="APPROVALS" width={33} height={18} />}
                <g dangerouslySetInnerHTML={{ __html: art.officeArt.glazing }} />
              </g>;
              if (editor?.ghost?.id === item.machine.id) return null;
              return <g key={item.machine.id} data-depth={depth}><Machine machine={item.machine} active={active === item.machine.id}
                onInspect={onInspect} onHover={onHover} art={rotatedArt.get(item.machine.rotation ?? 0)!}
                hitPath={editor ? rotatedArt.get(item.machine.rotation ?? 0)!.itemPlane(...footprint({ ...asItem(item.machine), rotation: 0 }, catalog)) : undefined}
                position={layout ? itemPosition(asItem(item.machine)) : undefined} /></g>;
            })}
          </g>
          {editor && layout && <g className="floor-edit-overlay" pointerEvents="none" aria-hidden="true">
            {!editor.ghost && [...layout.machines, ...layout.decor].filter((item) => item.id === editor.selected).map((item) =>
              <path key={item.id} className="floor-selection-cell" d={footprintPath(item)} />)}
            <path className="floor-cursor-cell" d={footprintPath({ id: "cursor", name: "Cursor", kind: "zone", x: editor.cursor[0], y: editor.cursor[1], width: 1, height: 1, rotation: 0 })} />
            {editor.ghost && <g data-placement-valid={editor.valid}>
              <path className="floor-ghost-cell" d={footprintPath(editor.ghost)} />
              <g className="floor-ghost-model">{isMachine(editor.ghost) ? <Machine machine={{ ...editor.ghost,
                floor_x: layout.origin_x + editor.ghost.x * 10, floor_y: layout.origin_y + editor.ghost.y * 10,
                status: "idle", current_order_number: null, part_count: 0, utilisation_today: 0 }} active={false}
                interactive={false} onInspect={() => undefined} onHover={() => undefined} art={rotatedArt.get(editor.ghost.rotation)!} position={itemPosition(editor.ghost)} /> : renderDecor(editor.ghost, true)}</g>
            </g>}
          </g>}
          {marker && selected && <g className="floor-marker" transform={`translate(${marker.join(" ")}) scale(${1 / view.zoom})`}
            data-status={selected.status} aria-hidden="true" pointerEvents="none">
            <rect x="-62" y="-27" width="124" height="24" rx="7" />
            <path d="M-4-3 0 2 4-3Z" />
            <circle cx="-49" cy="-15" r="3.5" />
            <text x="-39" y="-11" textLength={selected.code.length > 12 ? 92 : undefined}
              lengthAdjust="spacingAndGlyphs">{selected.code}</text>
          </g>}
        </g>
      </svg>
    </div>
    <CameraControls controls={controls} />
  </>;
}

function cartOpacity(progress: number) {
  return Math.max(0, Math.min(1, progress * 16, (1.15 - progress) * 16));
}
