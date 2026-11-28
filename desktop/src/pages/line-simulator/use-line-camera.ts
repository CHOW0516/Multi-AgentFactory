import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import type { LineBlock } from "./engine";
import { BLOCK_HEIGHT, BLOCK_WIDTH, CANVAS_HEIGHT, CANVAS_WIDTH } from "./model";

type View = { x: number; y: number; zoom: number };
const initialView: View = { x: 0, y: 0, zoom: 1 };
export const MIN_LINE_ZOOM = .05;
export const MAX_LINE_ZOOM = 3;
const clampZoom = (zoom: number) => Math.max(MIN_LINE_ZOOM, Math.min(MAX_LINE_ZOOM, zoom));

function fitView(blocks: LineBlock[]): View {
  if (!blocks.length) return initialView;
  const left = Math.min(...blocks.map((block) => block.x - BLOCK_WIDTH / 2)) - 60;
  const top = Math.min(...blocks.map((block) => block.y - BLOCK_HEIGHT / 2)) - 60;
  const right = Math.max(...blocks.map((block) => block.x + BLOCK_WIDTH / 2)) + 60;
  const bottom = Math.max(...blocks.map((block) => block.y + BLOCK_HEIGHT / 2)) + 60;
  const zoom = clampZoom(Math.min(CANVAS_WIDTH / (right - left), CANVAS_HEIGHT / (bottom - top), 1));
  return { x: (left + right - CANVAS_WIDTH / zoom) / 2, y: (top + bottom - CANVAS_HEIGHT / zoom) / 2, zoom };
}

/** Camera changes never change design coordinates or invalidate simulation results. */
export function useLineCamera(scene: RefObject<SVGSVGElement>, blocks: LineBlock[]) {
  const [view, setView] = useState<View>(() => blocks.every((block) => block.x - BLOCK_WIDTH / 2 >= 0 &&
    block.y - BLOCK_HEIGHT / 2 >= 0 && block.x + BLOCK_WIDTH / 2 <= CANVAS_WIDTH && block.y + BLOCK_HEIGHT / 2 <= CANVAS_HEIGHT)
    ? initialView : fitView(blocks));
  const latest = useRef(view);
  const frame = useRef(0);
  const pan = useRef<{ id: number; clientX: number; clientY: number; scale: number; view: View } | null>(null);
  const moved = useRef(false);
  const [moving, setMoving] = useState(false);

  function change(next: View, dragging = false) {
    latest.current = next;
    if (!dragging) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      setView(next);
    } else if (!frame.current) {
      frame.current = requestAnimationFrame(() => { frame.current = 0; setView(latest.current); });
    }
  }

  function toWorld(clientX: number, clientY: number) {
    const matrix = scene.current?.getScreenCTM?.();
    if (matrix) {
      const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
      return { x: point.x, y: point.y };
    }
    const box = scene.current?.getBoundingClientRect();
    const width = box?.width || CANVAS_WIDTH, height = box?.height || CANVAS_HEIGHT;
    const scale = Math.min(width / CANVAS_WIDTH, height / CANVAS_HEIGHT);
    return {
      x: latest.current.x + (clientX - (box?.left ?? 0) - (width - CANVAS_WIDTH * scale) / 2) / scale / latest.current.zoom,
      y: latest.current.y + (clientY - (box?.top ?? 0) - (height - CANVAS_HEIGHT * scale) / 2) / scale / latest.current.zoom,
    };
  }

  function zoom(ratio: number, anchor?: { x: number; y: number }) {
    const current = latest.current;
    const point = anchor ?? { x: current.x + CANVAS_WIDTH / current.zoom / 2, y: current.y + CANVAS_HEIGHT / current.zoom / 2 };
    const zoom = clampZoom(current.zoom * ratio);
    const fraction = current.zoom / zoom;
    change({ zoom, x: point.x - (point.x - current.x) * fraction, y: point.y - (point.y - current.y) * fraction }, true);
  }

  useEffect(() => {
    const element = scene.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.deltaY || pan.current) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 320 : 1);
      zoom(Math.exp(-Math.max(-300, Math.min(300, delta)) * .0017), toWorld(event.clientX, event.clientY));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => { element.removeEventListener("wheel", wheel); cancelAnimationFrame(frame.current); };
  }, [scene]);

  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    moved.current = false;
    if (event.button !== 1 && event.button !== 2) return;
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    const scale = Math.min((box.width || CANVAS_WIDTH) / CANVAS_WIDTH, (box.height || CANVAS_HEIGHT) / CANVAS_HEIGHT);
    pan.current = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY, scale, view: latest.current };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const gesture = pan.current;
    if (!gesture || gesture.id !== event.pointerId) return false;
    const dx = event.clientX - gesture.clientX, dy = event.clientY - gesture.clientY;
    if (!moved.current && Math.hypot(dx, dy) < 5) return false;
    moved.current = true;
    setMoving(true);
    change({ ...gesture.view, x: gesture.view.x - dx / gesture.scale / gesture.view.zoom,
      y: gesture.view.y - dy / gesture.scale / gesture.view.zoom }, true);
    return true;
  }

  function onPointerEnd(event: PointerEvent<SVGSVGElement>) {
    if (pan.current?.id !== event.pointerId) return;
    pan.current = null;
    change(latest.current);
    setMoving(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const bounds = useMemo(() => ({ x: view.x, y: view.y, width: CANVAS_WIDTH / view.zoom, height: CANVAS_HEIGHT / view.zoom }), [view]);
  const fit = () => change(fitView(blocks));
  const reset = () => change(initialView);
  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.target !== event.currentTarget) return;
    const current = latest.current;
    switch (event.key) {
      case "+": case "=": zoom(1.22); break;
      case "-": zoom(1 / 1.22); break;
      case "Home": case "0": reset(); break;
      case "f": case "F": fit(); break;
      case "ArrowLeft": change({ ...current, x: current.x - 60 / current.zoom }); break;
      case "ArrowRight": change({ ...current, x: current.x + 60 / current.zoom }); break;
      case "ArrowUp": change({ ...current, y: current.y - 60 / current.zoom }); break;
      case "ArrowDown": change({ ...current, y: current.y + 60 / current.zoom }); break;
      default: return;
    }
    event.preventDefault();
  }

  return { view, bounds, moving, moved, toWorld, zoom, fit, reset, isPanning: () => pan.current !== null,
    handlers: { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd, onLostPointerCapture: onPointerEnd, onKeyDown } };
}
