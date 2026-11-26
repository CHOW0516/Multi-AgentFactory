// The flat 2D canvas: draw blocks and links, drag to move, drag from a port to link, show playback.
import { useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from "react";
import { canLink, type LineBlock, type LineDesign, type MachineState } from "./engine";
import { BLOCK_HEIGHT, BLOCK_WIDTH, CANVAS_HEIGHT, CANVAS_WIDTH, blockAt, clampPosition, newId } from "./model";

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

export function LineCanvas({ design, onChange, selection, onSelect, playback, onDropItem }: {
  design: LineDesign;
  onDropItem: (item: string, x: number, y: number) => void;
  onChange: (design: LineDesign) => void;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  playback: PlaybackView | null;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const blocksById = new Map(design.blocks.map((block) => [block.id, block]));

  function toCanvas(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const matrix = svg.getScreenCTM?.();
    if (matrix) {
      const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
      return { x: point.x, y: point.y };
    }
    const box = svg.getBoundingClientRect();
    return {
      x: (clientX - box.left) * (CANVAS_WIDTH / (box.width || CANVAS_WIDTH)),
      y: (clientY - box.top) * (CANVAS_HEIGHT / (box.height || CANVAS_HEIGHT)),
    };
  }

  function onBlockPointerDown(event: PointerEvent, block: LineBlock) {
    if (event.button !== 0) return;
    event.stopPropagation();
    svgRef.current?.setPointerCapture?.(event.pointerId);
    const point = toCanvas(event.clientX, event.clientY);
    const onPort = (event.target as Element).hasAttribute("data-port");
    if (onPort) setGesture({ kind: "link", fromId: block.id, ...point });
    else setGesture({ kind: "move", blockId: block.id, offsetX: point.x - block.x, offsetY: point.y - block.y, moved: false });
    onSelect({ kind: "block", id: block.id });
  }

  function onPointerMove(event: PointerEvent) {
    if (!gesture) return;
    const point = toCanvas(event.clientX, event.clientY);
    if (gesture.kind === "link") { setGesture({ ...gesture, ...point }); return; }
    const position = clampPosition(point.x - gesture.offsetX, point.y - gesture.offsetY);
    const block = blocksById.get(gesture.blockId);
    if (!block || (block.x === position.x && block.y === position.y)) return;
    onChange({ ...design, blocks: design.blocks.map((item) => item.id === block.id ? { ...item, ...position } : item) });
    if (!gesture.moved) setGesture({ ...gesture, moved: true });
  }

  function onPointerUp(event: PointerEvent) {
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

  function onKeyDown(event: KeyboardEvent) {
    if ((event.key !== "Delete" && event.key !== "Backspace") || !selection) return;
    event.preventDefault();
    if (selection.kind === "link") onChange({ ...design, links: design.links.filter((link) => link.id !== selection.id) });
    else onChange({
      ...design,
      blocks: design.blocks.filter((block) => block.id !== selection.id),
      links: design.links.filter((link) => link.from !== selection.id && link.to !== selection.id),
    });
    onSelect(null);
  }

  const linkingFrom = gesture?.kind === "link" ? blocksById.get(gesture.fromId) : undefined;

  return (
    <svg ref={svgRef} className="ls-canvas" viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`} role="application"
      aria-label="Machine line canvas. Drag blocks to move them. Drag from the round port on a block's right side to another block to link them. Press Delete to remove the selected item."
      tabIndex={0} data-testid="line-canvas"
      onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setGesture(null)}
      onPointerDown={() => onSelect(null)} onKeyDown={onKeyDown}
      onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <defs>
        <pattern id="ls-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" className="ls-grid-dot" />
        </pattern>
        <marker id="ls-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" className="ls-arrow" />
        </marker>
      </defs>
      <rect width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="url(#ls-grid)" />

      {design.links.map((link) => {
        const from = blocksById.get(link.from), to = blocksById.get(link.to);
        if (!from || !to) return null;
        const selected = selection?.kind === "link" && selection.id === link.id;
        const path = linkPath(from, to);
        return (
          <g key={link.id} className={`ls-link${selected ? " is-selected" : ""}`} data-testid={`line-link-${link.from}-${link.to}`}
            onPointerDown={(event) => { event.stopPropagation(); onSelect({ kind: "link", id: link.id }); }}>
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
  );
}
