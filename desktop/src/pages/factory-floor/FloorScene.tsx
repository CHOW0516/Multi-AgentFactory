import { memo, useEffect, useId, useMemo, useRef } from "react";
import type { FloorMachine } from "../../api/types";
import { depthOf } from "../../iso/iso-kit";
import { activateOnKey } from "../../figures/figure-ui";
import { bayArt, cartArt, cartTrack, floorCamera, floorDeck, genericMachineArt, kindFor, machineArt, officeArt, storeArt } from "../../figures/floor-geometry";
import { buildWith, compareDepth } from "../../figures/geometry";
import { useFigureFrames, useMotionVisibility } from "../../figures/motion";
import { mechanismTransform, statusNames } from "./model";

const floor = buildWith(floorCamera);

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

const Machine = memo(function Machine({ machine, active, onInspect, onHover }: {
  machine: FloorMachine; active: boolean; onInspect: (id: string) => void; onHover: (id: string | null) => void;
}) {
  const kind = kindFor(machine.machine_type);
  const art = kind ? machineArt[kind] : genericMachineArt;
  const select = () => onInspect(machine.id);
  return <g transform={floor.position([machine.floor_x, machine.floor_y, 0])}
    className="p5-scene-target p5-machine" data-machine={machine.id} data-kind={kind ?? "generic"} data-status={machine.status}
    data-active={active || undefined} role="button" tabIndex={0} aria-label={`${machine.name}, ${statusNames[machine.status]}`}
    onClick={select} onKeyDown={(event) => activateOnKey(event, select)} onPointerEnter={() => onHover(machine.id)}
    onPointerLeave={() => onHover(null)} onFocus={() => onHover(machine.id)} onBlur={() => onHover(null)}>
    <g dangerouslySetInnerHTML={{ __html: art.body }} />
    {art.window && kind ? <Mechanism kind={kind} transform={art.window} /> : null}
    <Display transform={art.screen} line={machine.current_order_number ?? "STANDBY"} detail={`${machine.part_count} PCS`} />
    <g transform={art.light} data-stack-light="" data-status={machine.status} className="p5-beacon" aria-hidden="true">
      {[0, 4.2, 8.4, 12.6, 16.8].map((top) => <rect key={top} className="p5-beacon-off" x="0" y={top} width="9" height="4" />)}
      <rect className="p5-beacon-on" x="0" y="0" width="9" height="4.1" />
    </g>
    <title>{machine.code} · {machine.current_order_number ?? "No current order"} · {machine.part_count} parts</title>
  </g>;
});

export type CartArrival = { id: string; x: number; y: number };

export function FloorScene({ machines, approvals, active, onInspect, onHover, arrival }: {
  machines: FloorMachine[]; approvals: number; active: string | null; onInspect: (id: string) => void;
  onHover: (id: string | null) => void; arrival: CartArrival | null;
}) {
  const scene = useRef<SVGSVGElement>(null);
  const fixtures = useRef<SVGGElement>(null);
  const cart = useRef<SVGGElement | null>(null);
  const activeCart = useRef({ id: "", began: 0 });
  const runningMechanisms = useRef<{ node: SVGGElement; kind: string }[]>([]);
  const { visible, reduced } = useMotionVisibility(scene);
  const route = useMemo(() => arrival && cartTrack(arrival.x, arrival.y), [arrival]);
  const deck = useMemo(() => floorDeck(machines), [machines]);

  useEffect(() => {
    const layer = fixtures.current;
    if (!route || !layer) return;
    // Keep the cart outside React's child order so it can pass behind the stationary fixtures.
    const part = document.createElementNS("http://www.w3.org/2000/svg", "g");
    part.setAttribute("aria-hidden", "true");
    part.setAttribute("pointer-events", "none");
    part.setAttribute("data-cart", "");
    part.innerHTML = cartArt;
    cart.current = part;
    placeCart(part, layer, route(reduced ? 1 : 0), reduced ? .95 : 0);
    return () => {
      part.remove();
      cart.current = null;
    };
  }, [route, reduced]);

  useEffect(() => {
    runningMechanisms.current = Array.from(scene.current?.querySelectorAll<SVGGElement>("[data-mechanism]") ?? []).flatMap((node) => {
      const host = node.closest("[data-kind]");
      if (host?.getAttribute("data-status") === "running") return [{ node, kind: host.getAttribute("data-kind") ?? "" }];
      node.removeAttribute("transform");
      return [];
    });
  }, [machines]);

  useFigureFrames(visible && !reduced && (Boolean(route) || machines.some((machine) => machine.status === "running")),
    (time) => {
      for (const mechanism of runningMechanisms.current) mechanism.node.setAttribute("transform", mechanismTransform(mechanism.kind, time));
      if (route && arrival && cart.current && fixtures.current) {
        if (activeCart.current.id !== arrival.id) activeCart.current = { id: arrival.id, began: time };
        const progress = (time - activeCart.current.began) / 4000;
        if (progress < 1.2) placeCart(cart.current, fixtures.current, route(progress),
          Math.max(0, Math.min(1, progress * 16, (1.15 - progress) * 16)));
      }
    });

  const sorted = [
    ...machines.map((machine) => ({ type: "machine" as const, position: [machine.floor_x + 52, machine.floor_y + 40, 22] as [number, number, number], machine })),
    { type: "store" as const, position: storeArt.position },
    { type: "office" as const, position: officeArt.position },
  ].sort((left, right) => compareDepth(floorCamera, left.position, right.position));

  return <div className="p5-scene-scroll"><svg ref={scene} className="iso-svg p5-scene" data-animate={visible && !reduced || undefined}
    viewBox={deck.viewBox} aria-label="Interactive isometric factory floor" role="group">
    <g dangerouslySetInnerHTML={{ __html: deck.art }} aria-hidden="true" />
    {machines.map((machine) => <g key={machine.id} transform={floor.position([machine.floor_x, machine.floor_y, 0])}
      data-bay-active={active === machine.id || undefined}
      dangerouslySetInnerHTML={{ __html: bayArt(kindFor(machine.machine_type)) }} aria-hidden="true" />)}
    <g ref={fixtures}>
      {sorted.map((item) => {
        const depth = depthOf(item.position, floorCamera);
        if (item.type === "store") return <g key="store" data-depth={depth} dangerouslySetInnerHTML={{ __html: storeArt.art }} aria-hidden="true" />;
        if (item.type === "office") return <g key="office" data-depth={depth} transform={officeArt.transform} aria-hidden="true">
          <g dangerouslySetInnerHTML={{ __html: officeArt.base }} />
          <Display transform={officeArt.display} line={String(approvals)} detail="APPROVALS" width={33} height={18} />
          <g dangerouslySetInnerHTML={{ __html: officeArt.glazing }} />
        </g>;
        return <g key={item.machine.id} data-depth={depth}><Machine machine={item.machine} active={active === item.machine.id}
          onInspect={onInspect} onHover={onHover} /></g>;
      })}
    </g>
  </svg></div>;
}
