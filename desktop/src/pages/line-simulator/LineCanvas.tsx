// The flat 2D canvas: draw blocks and links, drag to move, drag from a port to link, show playback.
import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from "react";
import { canLink, type LineBlock, type LineDesign, type MachineState } from "./engine";
import { BLOCK_HEIGHT, BLOCK_WIDTH, blockAt, snapPosition, newId, removeBlock, type CanvasBounds } from "./model";
import { Icon } from "../../shell/icons";
import { LineContextMenu } from "./LineContextMenu";
import { MAX_LINE_ZOOM, MIN_LINE_ZOOM, useLineCamera } from "./use-line-camera";

export type Selection = { kind: "block" | "link"; id: string } | null;

/** What the canvas shows while a simulation plays. */
export interface PlaybackView {
  states: Record<string, MachineState>;
  queues: Record<string, number>;
  shipped: Record<string, number>;
  dots: { id: number; from: string; to: string; progress: number; jobIndex: number }[];
  bottleneckId: string | null;
}

const TYPE_TAGS: Record<string, string> = {
  cnc_lathe: "LATHE", cnc_mill: "MILL", laser_cutter: "LASER", press_brake: "BRAKE",
  qc_station: "QC", packing: "PACK", other: "MACHINE",
};

function tagFor(block: LineBlock) {
  if (block.kind === "source") return "IN";
  if (block.kind === "sink") return "OUT";
  return TYPE_TAGS[block.machineType] ?? "MACHINE";
}

/** Link curve from the right side of one block to the left side of the next. */
function linkPoints(from: LineBlock, to: { x: number; y: number }, toIsBlock = true) {
  const startX = from.x + BLOCK_WIDTH / 2, startY = from.y;
  const endX = toIsBlock ? to.x - BLOCK_WIDTH / 2 - 4 : to.x, endY = to.y;
  const bend = Math.max(40, Math.abs(endX - startX) / 2);
  return { startX, startY, endX, endY, control1X: startX + bend, control2X: endX - bend };
}

function linkPath(from: LineBlock, to: { x: number; y: number }, toIsBlock = true) {
  const point = linkPoints(from, to, toIsBlock);
  return `M${point.startX} ${point.startY} C${point.control1X} ${point.startY} ${point.control2X} ${point.endY} ${point.endX} ${point.endY}`;
}

function pointOnLink(from: LineBlock, to: LineBlock, progress: number) {
  const point = linkPoints(from, to);
  const inverse = 1 - progress;
  const x = inverse ** 3 * point.startX + 3 * inverse ** 2 * progress * point.control1X
    + 3 * inverse * progress ** 2 * point.control2X + progress ** 3 * point.endX;
  const y = inverse ** 3 * point.startY + 3 * inverse ** 2 * progress * point.startY
    + 3 * inverse * progress ** 2 * point.endY + progress ** 3 * point.endY;
  return { x, y };
}

type Gesture =
  | { kind: "move"; blockId: string; offsetX: number; offsetY: number; moved: boolean }
  | { kind: "link"; fromId: string; x: number; y: number };

export function LineCanvas({ design, onChange, selection, onSelect, playback, onDropItem, onViewportChange }: {
  design: LineDesign;
  onDropItem: (item: string, x: number, y: number) => void;
  onChange: (design: LineDesign) => void;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  playback: PlaybackView | null;
  onViewportChange: (bounds: CanvasBounds) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const camera = useLineCamera(svgRef, design.blocks);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [menu, setMenu] = useState<{ target: NonNullable<Selection>; x: number; y: number } | null>(null);
  const pendingMenu = useRef<typeof menu>(null);
  const blocksById = new Map(design.blocks.map((block) => [block.id, block]));
  const toCanvas = camera.toWorld;
  useEffect(() => onViewportChange(camera.bounds), [camera.bounds, onViewportChange]);
  const closeMenu = useCallback((restoreFocus = false) => {
    setMenu(null);
    if (restoreFocus) svgRef.current?.focus({ preventScroll: true });
  }, []);

  function targetAt(element: EventTarget | null): Selection {
    if (!(element instanceof Element)) return null;
    const block = element.closest("[data-block-id]")?.getAttribute("data-block-id");
    if (block) return { kind: "block", id: block };
    const link = element.closest("[data-link-id]")?.getAttribute("data-link-id");
    return link ? { kind: "link", id: link } : null;
  }

  function deleteItem(target: NonNullable<Selection>) {
    onChange(target.kind === "block" ? removeBlock(design, target.id) :
      { ...design, links: design.links.filter((link) => link.id !== target.id) });
    onSelect(null);
    setGesture(null);
    closeMenu(true);
  }

  function onBlockPointerDown(event: PointerEvent, block: LineBlock) {
    if (event.button !== 0) return;
    event.stopPropagation();
    closeMenu();
    camera.moved.current = false;
    svgRef.current?.focus({ preventScroll: true });
    svgRef.current?.setPointerCapture?.(event.pointerId);
    const point = toCanvas(event.clientX, event.clientY);
    const onPort = (event.target as Element).hasAttribute("data-port");
    if (onPort) setGesture({ kind: "link", fromId: block.id, ...point });
    else setGesture({ kind: "move", blockId: block.id, offsetX: point.x - block.x, offsetY: point.y - block.y, moved: false });
    onSelect({ kind: "block", id: block.id });
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (camera.handlers.onPointerMove(event)) { pendingMenu.current = null; closeMenu(); return; }
    if (!gesture) return;
    const point = toCanvas(event.clientX, event.clientY);
    if (gesture.kind === "link") { setGesture({ ...gesture, ...point }); return; }
    const position = snapPosition(point.x - gesture.offsetX, point.y - gesture.offsetY);
    const block = blocksById.get(gesture.blockId);
    if (!block || (block.x === position.x && block.y === position.y)) return;
    onChange({ ...design, blocks: design.blocks.map((item) => item.id === block.id ? { ...item, ...position } : item) });
    if (!gesture.moved) setGesture({ ...gesture, moved: true });
  }

  function onPointerUp(event: PointerEvent<SVGSVGElement>) {
    const candidate = pendingMenu.current;
    pendingMenu.current = null;
    camera.handlers.onPointerUp(event);
    if (candidate && !camera.moved.current) { onSelect(candidate.target); setMenu(candidate); }
    if (gesture?.kind === "link") {
      const point = toCanvas(event.clientX, event.clientY);
      const target = blockAt(design, point.x, point.y);
      if (target && canLink(design, gesture.fromId, target.id)) {
        onChange({ ...design, links: [...design.links, { id: newId("link"), from: gesture.fromId, to: target.id }] });
      }
    }
    setGesture(null);
  }

  function onDrop(event: DragEvent) {
    const item = event.dataTransfer.getData("application/x-line-block");
    if (!item) return;
    event.preventDefault();
    const point = toCanvas(event.clientX, event.clientY);
    onDropItem(item, point.x, point.y);
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    delete event.currentTarget.dataset.pointerFocus;
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      const target = targetAt(event.target) ?? selection;
      if (!target) return;
      const box = (event.target as Element).getBoundingClientRect();
      onSelect(target);
      setMenu({ target, x: box.x + box.width / 2, y: box.y + box.height / 2 });
      return;
    }
    camera.handlers.onKeyDown(event);
    if ((event.key !== "Delete" && event.key !== "Backspace") || !selection) return;
    event.preventDefault();
    deleteItem(selection);
  }

  const linkingFrom = gesture?.kind === "link" ? blocksById.get(gesture.fromId) : undefined;

  const { x, y, width, height } = camera.bounds;
  return (<>
    <svg ref={svgRef} className="ls-canvas" viewBox={`${x} ${y} ${width} ${height}`} role="application"
      data-moving={camera.moving || undefined} data-zoom={camera.view.zoom}
      aria-label="Machine line canvas. Drag blocks to move; drag from a round output port to connect. Right-click an element for actions, or right-drag to pan. Scroll to zoom. Arrows pan, plus and minus zoom, F fits the line, Home resets. Delete removes the selected element."
      tabIndex={0} data-testid="line-canvas"
      onPointerDownCapture={(event) => { event.currentTarget.dataset.pointerFocus = "true"; }}
      onBlur={(event) => { if (event.target === event.currentTarget) delete event.currentTarget.dataset.pointerFocus; }}
      onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      onPointerCancel={(event) => { pendingMenu.current = null; camera.handlers.onPointerCancel(event); setGesture(null); }}
      onLostPointerCapture={(event) => { pendingMenu.current = null; camera.handlers.onLostPointerCapture(event); setGesture(null); }}
      onPointerDown={(event) => { pendingMenu.current = null; closeMenu(); camera.handlers.onPointerDown(event); setGesture(null); if (event.button === 0) onSelect(null); }}
      onContextMenu={(event) => {
        event.preventDefault();
        const target = targetAt(event.target);
        if (camera.moved.current || !target) { closeMenu(); return; }
        const candidate = { target, x: event.clientX, y: event.clientY };
        // Some browsers emit contextmenu on press; wait for release to distinguish a pan.
        if (camera.isPanning()) { pendingMenu.current = candidate; return; }
        onSelect(target);
        setMenu(candidate);
      }} onKeyDown={onKeyDown}
      onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <defs>
        <pattern id="ls-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" className="ls-grid-dot" />
        </pattern>
        <marker id="ls-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="14" markerHeight="14" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" className="ls-arrow" />
        </marker>
      </defs>
      <rect x={x - width} y={y - height} width={width * 3} height={height * 3} fill="url(#ls-grid)" />

      {design.links.map((link) => {
        const from = blocksById.get(link.from), to = blocksById.get(link.to);
        if (!from || !to) return null;
        const selected = selection?.kind === "link" && selection.id === link.id;
        const path = linkPath(from, to);
        return (
          <g key={link.id} className={`ls-link${selected ? " is-selected" : ""}`} data-testid={`line-link-${link.from}-${link.to}`}
            data-link-id={link.id} role="button" tabIndex={0} aria-label={`Connection from ${from.name} to ${to.name}`}
            onFocus={() => onSelect({ kind: "link", id: link.id })}
            onPointerDown={(event) => { if (event.button !== 0) return; event.stopPropagation(); closeMenu(); camera.moved.current = false;
              svgRef.current?.focus({ preventScroll: true }); onSelect({ kind: "link", id: link.id }); }}>
            <path d={path} className="ls-link-hit" />
            <path d={path} className="ls-link-line" markerEnd="url(#ls-arrow)" />
          </g>
        );
      })}

      {linkingFrom && gesture?.kind === "link" ? (
        <path d={linkPath(linkingFrom, gesture, false)} className="ls-link-line ls-link-draft" />
      ) : null}

      {design.blocks.map((block) => {
        const selected = selection?.kind === "block" && selection.id === block.id;
        const state = playback?.states[block.id];
        const queue = playback?.queues[block.id] ?? 0;
        const isBottleneck = playback?.bottleneckId === block.id;
        return (
          <g key={block.id} transform={`translate(${block.x - BLOCK_WIDTH / 2} ${block.y - BLOCK_HEIGHT / 2})`}
            className={`ls-block ls-${block.kind}${selected ? " is-selected" : ""}${isBottleneck ? " is-bottleneck" : ""}`}
            data-testid={`line-block-${block.id}`} data-state={state ?? ""}
            data-block-id={block.id} role="button" tabIndex={0} aria-label={block.name}
            onFocus={() => onSelect({ kind: "block", id: block.id })}
            onPointerDown={(event) => onBlockPointerDown(event, block)}>
            <title>{block.name}</title>
            <rect className="ls-block-body" width={BLOCK_WIDTH} height={BLOCK_HEIGHT} rx="10" />
            <rect className={`ls-block-stripe ls-state-${state ?? "none"}`} width="6" height={BLOCK_HEIGHT - 16} x="8" y="8" rx="3" />
            <text className="ls-block-tag" x="22" y="24">{tagFor(block)}</text>
            <text className="ls-block-name" x="22" y="44">{block.name.length > 13 ? `${block.name.slice(0, 12)}…` : block.name}</text>
            {block.kind === "machine" && playback ? (
              <g transform={`translate(${BLOCK_WIDTH - 34} 6)`} aria-label={`Queue ${queue}`}>
                <rect className="ls-queue" width="28" height="16" rx="8" />
                <text className="ls-queue-text" x="14" y="12">{queue}</text>
              </g>
            ) : null}
            {block.kind === "sink" && playback ? (
              <text className="ls-block-tag" x={BLOCK_WIDTH - 10} y="24" textAnchor="end">{playback.shipped[block.id] ?? 0}</text>
            ) : null}
            {block.kind !== "sink" ? <circle data-port="" className="ls-port" cx={BLOCK_WIDTH} cy={BLOCK_HEIGHT / 2} r="7" /> : null}
            {block.kind !== "source" ? <circle className="ls-port-in" cx="0" cy={BLOCK_HEIGHT / 2} r="4" /> : null}
          </g>
        );
      })}

      {playback?.dots.map((dot) => {
        const from = blocksById.get(dot.from), to = blocksById.get(dot.to);
        if (!from || !to) return null;
        const point = pointOnLink(from, to, dot.progress);
        return <circle key={dot.id} cx={point.x} cy={point.y} r="5" className={`ls-dot ls-job-${dot.jobIndex % 6}`} />;
      })}
    </svg>
    <div className="ls-camera-controls" role="group" aria-label="Canvas controls">
      <button type="button" className="icon-button" aria-label="Zoom in" data-tooltip="Zoom in" disabled={camera.view.zoom >= MAX_LINE_ZOOM} onClick={() => { closeMenu(); camera.zoom(1.22); }}><Icon name="plus" /></button>
      <output aria-label="Canvas zoom">{Math.round(camera.view.zoom * 100)}%</output>
      <button type="button" className="icon-button" aria-label="Zoom out" data-tooltip="Zoom out" disabled={camera.view.zoom <= MIN_LINE_ZOOM} onClick={() => { closeMenu(); camera.zoom(1 / 1.22); }}><Icon name="minus" /></button>
      <span className="ls-camera-divider" />
      <button type="button" className="icon-button" aria-label="Fit line" data-tooltip="Fit line (F)" onClick={() => { closeMenu(); camera.fit(); }}><Icon name="focus" /></button>
      <button type="button" className="icon-button" aria-label="Reset camera" data-tooltip="Reset camera (Home)" onClick={() => { closeMenu(); camera.reset(); }}><Icon name="home" /></button>
    </div>
    <p className="ls-canvas-hint">Right-drag to pan · Scroll to zoom · Right-click an element for actions</p>
    {menu && <LineContextMenu x={menu.x} y={menu.y} kind={menu.target.kind} onClose={closeMenu} onDelete={() => deleteItem(menu.target)} />}
  </>);
}
