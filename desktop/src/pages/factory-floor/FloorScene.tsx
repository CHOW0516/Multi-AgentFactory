import { memo, useEffect, useId, useMemo, useRef } from "react";
import type { FloorMachine } from "../../api/types";
import { depthOf, type Point3 } from "../../iso/iso-kit";
import { activateOnKey } from "../../figures/figure-ui";
import { floorArt, kindFor } from "../../figures/floor-geometry";
import { compareDepth } from "../../figures/geometry";
import { useFigureFrames, useMotionVisibility } from "../../figures/motion";
import { Icon } from "../../shell/icons";
import { floorProjection, floorViewport, locateInView, projectionAngles } from "./floor-camera";
import { mechanismTransform, statusNames } from "./model";
import { useFloorCamera } from "./use-floor-camera";

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

const Machine = memo(function Machine({ machine, active, onInspect, onHover, art }: {
  machine: FloorMachine; active: boolean; onInspect: (id: string) => void; onHover: (id: string | null) => void;
  art: ReturnType<typeof floorArt>;
}) {
  const kind = kindFor(machine.machine_type);
  const model = kind ? art.machineArt[kind] : art.genericMachineArt;
  const select = () => onInspect(machine.id);
  return <g transform={art.floor.position([machine.floor_x, machine.floor_y, 0])}
    className="p5-scene-target p5-machine" data-machine={machine.id} data-kind={kind ?? "generic"} data-status={machine.status}
    data-active={active || undefined} role="button" tabIndex={0} aria-label={`${machine.name}, ${statusNames[machine.status]}`}
    onClick={select} onKeyDown={(event) => activateOnKey(event, select)} onPointerEnter={() => onHover(machine.id)}
    onPointerLeave={() => onHover(null)} onFocus={() => onHover(machine.id)} onBlur={() => onHover(null)}>
    <g dangerouslySetInnerHTML={{ __html: model.body }} />
    {art.showFront && model.window && kind ? <Mechanism kind={kind} transform={model.window} /> : null}
    {art.showFront && <Display transform={model.screen} line={machine.current_order_number ?? "STANDBY"} detail={`${machine.part_count} PCS`} />}
    <g data-stack-light="" data-status={machine.status} className="p5-beacon" aria-hidden="true">
      {model.lenses.map(({ transform, width }, index) => <g key={index} transform={transform}>
        {[0, 4.2, 8.4, 12.6, 16.8].map((top) => <rect key={top} className="p5-beacon-off" x="0" y={top} width={width} height="4" />)}
        <rect className="p5-beacon-on" x="0" y="0" width={width} height="4.1" />
      </g>)}
    </g>
    <title>{machine.code} · {machine.current_order_number ?? "No current order"} · {machine.part_count} parts</title>
  </g>;
});

export type CartArrival = { id: string; x: number; y: number };
export type FocusRequest = { id: string };

export function FloorScene({ machines, approvals, active, onInspect, onHover, arrival, focus, inspecting = false }: {
  machines: FloorMachine[]; approvals: number; active: string | null; onInspect: (id: string) => void;
  onHover: (id: string | null) => void; arrival: CartArrival | null; focus?: FocusRequest | null; inspecting?: boolean;
}) {
  const hint = useId();
  const scene = useRef<SVGSVGElement>(null);
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
  const art = useMemo(() => floorArt(camera), [camera]);
  const route = useMemo(() => arrival && art.cartTrack(arrival.x, arrival.y), [arrival, art]);
  const deck = useMemo(() => art.floorDeck(machines), [art, machines]);
  const selected = machines.find((machine) => machine.id === active);

  useEffect(() => {
    if (!focus || focus === lastFocus.current || !scene.current) return;
    const machine = machines.find((entry) => entry.id === focus.id);
    if (!machine) return;
    lastFocus.current = focus;
    const width = scene.current.clientWidth;
    const offset: [number, number] = width > 760 ? [inspecting ? -152 : 0, 18] : [0, inspecting ? -107 : 0];
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

  useFigureFrames(visible && !reduced && (Boolean(route) || machines.some((machine) => machine.status === "running")),
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

  const sorted = useMemo(() => [
    ...machines.map((machine) => ({ type: "machine" as const, position: [machine.floor_x + 52, machine.floor_y + 40, 22] as Point3, machine })),
    { type: "store" as const, position: art.storeArt.position },
    { type: "office" as const, position: art.officeArt.position },
    ...art.yard.map((item) => ({ type: "yard" as const, position: item.depth, item })),
  ].sort((left, right) => compareDepth(camera, left.position, right.position)), [art, camera, machines]);
  const matrix = `translate(${floorViewport.x + view.x} ${floorViewport.y + view.y}) scale(${view.zoom}) translate(${-floorViewport.x} ${-floorViewport.y})`;
  const selectedKind = selected && kindFor(selected.machine_type);
  const markerArt = selectedKind ? art.machineArt[selectedKind] : art.genericMachineArt;
  const marker = selected && art.floor.at([selected.floor_x + 48, selected.floor_y + 34, markerArt.markerHeight]);

  return <>
    <span className="sr-only" id={hint}>Drag to orbit. Shift and drag to pan. Scroll or pinch to zoom. On the keyboard, use the arrows, plus, minus, and Home.</span>
    <div className="floor-viewport" data-moving={controls.moving || undefined}>
      <svg ref={scene} className="iso-svg p5-scene floor-model" data-animate={visible && !reduced || undefined}
        data-azimuth={azimuth} data-elevation={elevation} data-zoom={view.zoom.toFixed(2)}
        viewBox={`0 0 ${floorViewport.width} ${floorViewport.height}`} aria-label="Interactive isometric factory floor"
        aria-describedby={hint} role="group" tabIndex={0}
        {...controls.handlers} onClickCapture={(event) => {
          if (!controls.moved.current || event.detail === 0) return;
          event.stopPropagation();
          controls.moved.current = false;
        }}>
        <g transform={matrix}>
          <g dangerouslySetInnerHTML={{ __html: deck }} aria-hidden="true" />
          {machines.map((machine) => <g key={machine.id} transform={art.floor.position([machine.floor_x, machine.floor_y, 0])}
            data-bay-active={active === machine.id || undefined}
            dangerouslySetInnerHTML={{ __html: art.bayArt(kindFor(machine.machine_type)) }} aria-hidden="true" />)}
          <g ref={fixtures}>
            {sorted.map((item) => {
              const depth = depthOf(item.position, camera);
              if (item.type === "yard") return <g key={item.item.id} data-depth={depth} transform={art.floor.position(item.item.at)}
                dangerouslySetInnerHTML={{ __html: item.item.body }} aria-hidden="true" />;
              if (item.type === "store") return <g key="store" data-depth={depth} dangerouslySetInnerHTML={{ __html: art.storeArt.art }} aria-hidden="true" />;
              if (item.type === "office") return <g key="office" data-depth={depth} transform={art.officeArt.transform} aria-hidden="true">
                <g dangerouslySetInnerHTML={{ __html: art.officeArt.base }} />
                {art.showFront && <Display transform={art.officeArt.display} line={String(approvals)} detail="APPROVALS" width={33} height={18} />}
                <g dangerouslySetInnerHTML={{ __html: art.officeArt.glazing }} />
              </g>;
              return <g key={item.machine.id} data-depth={depth}><Machine machine={item.machine} active={active === item.machine.id}
                onInspect={onInspect} onHover={onHover} art={art} /></g>;
            })}
          </g>
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
    <div className="floor-camera-controls floor-panel" role="group" aria-label="Camera controls">
      <button className="icon-button" aria-label="Zoom in" title="Zoom in" onClick={() => controls.zoom(1.22)} disabled={view.zoom >= 2.75}><Icon name="plus" /></button>
      <button className="icon-button" aria-label="Zoom out" title="Zoom out" onClick={() => controls.zoom(1 / 1.22)} disabled={view.zoom <= .58}><Icon name="minus" /></button>
      <span className="floor-camera-divider" />
      <button className="icon-button" aria-label="Rotate left" title="Rotate left" onClick={() => controls.turn(-30)}><Icon name="rotate-left" /></button>
      <button className="icon-button" aria-label="Rotate right" title="Rotate right" onClick={() => controls.turn(30)}><Icon name="rotate-right" /></button>
      <span className="floor-camera-divider" />
      <button className="icon-button" aria-label="Reset camera" title="Reset camera" onClick={controls.reset}><Icon name="home" /></button>
    </div>
  </>;
}

function cartOpacity(progress: number) {
  return Math.max(0, Math.min(1, progress * 16, (1.15 - progress) * 16));
}
