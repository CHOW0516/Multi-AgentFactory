import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { floorViewport, initialView, orbit, zoomAt, type FloorView } from "./floor-camera";

type Pair = [number, number];
type Gesture = {
  view: FloorView;
  centre: Pair;
  distance: number;
  pan: boolean;
};

function midpoint(points: Pair[]): Pair {
  const [first, second] = points;
  return second ? [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2] : first;
}

function separation([first, second]: Pair[]) {
  return second ? Math.max(1, Math.hypot(second[0] - first[0], second[1] - first[1])) : 0;
}

function units(box: DOMRect) {
  return Math.max(.01, Math.min(box.width / floorViewport.width, box.height / floorViewport.height));
}

function fromViewCentre(point: Pair, box: DOMRect): Pair {
  const scale = units(box);
  return [
    (point[0] - box.left - box.width / 2) / scale + floorViewport.width / 2 - floorViewport.x,
    (point[1] - box.top - box.height / 2) / scale + floorViewport.height / 2 - floorViewport.y,
  ];
}

export function useFloorCamera(scene: RefObject<SVGSVGElement>) {
  const [view, setView] = useState(initialView);
  const [moving, setMoving] = useState(false);
  const latest = useRef(view);
  const destination = useRef<FloorView | null>(null);
  const points = useRef(new Map<number, Pair>());
  const gesture = useRef<Gesture | null>(null);
  const moved = useRef(false);
  const frame = useRef(0);
  const tween = useRef(0);

  function stopTransition() {
    cancelAnimationFrame(tween.current);
    tween.current = 0;
    destination.current = null;
  }

  function change(next: FloorView, dragging = false) {
    stopTransition();
    latest.current = next;
    if (!dragging) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      setView(next);
    } else if (!frame.current) {
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        setView(latest.current);
      });
    }
  }

  function animate(next: FloorView) {
    stopTransition();
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      change(next);
      return;
    }
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    destination.current = next;
    const from = latest.current;
    const yaw = ((next.azimuth - from.azimuth + 540) % 360) - 180;
    let start: number | undefined;
    function tick(now: number) {
      start ??= now;
      const elapsed = Math.min(1, (now - start) / 220);
      const fraction = 1 - (1 - elapsed) ** 3;
      const mix = (first: number, last: number) => first + (last - first) * fraction;
      latest.current = elapsed === 1 ? next : {
        azimuth: (from.azimuth + yaw * fraction + 360) % 360,
        elevation: mix(from.elevation, next.elevation),
        zoom: mix(from.zoom, next.zoom),
        x: mix(from.x, next.x),
        y: mix(from.y, next.y),
      };
      setView(latest.current);
      if (elapsed < 1) tween.current = requestAnimationFrame(tick);
      else stopTransition();
    }
    tween.current = requestAnimationFrame(tick);
  }

  useEffect(() => {
    const element = scene.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      const anchor = fromViewCentre([event.clientX, event.clientY], element.getBoundingClientRect());
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 320 : 1);
      change(zoomAt(latest.current, Math.exp(-Math.max(-300, Math.min(300, delta)) * .0017), anchor), true);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", wheel);
      cancelAnimationFrame(frame.current);
      stopTransition();
    };
  }, [scene]);

  function start(pan: boolean) {
    const active = [...points.current.values()];
    gesture.current = active.length ? { view: latest.current, centre: midpoint(active), distance: separation(active), pan } : null;
  }

  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.button === 1) event.preventDefault();
    if (!points.current.size) {
      moved.current = false;
      stopTransition();
    }
    points.current.set(event.pointerId, [event.clientX, event.clientY]);
    if (points.current.size <= 2) start(event.shiftKey || event.button === 1);
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!points.current.has(event.pointerId) || !gesture.current) return;
    points.current.set(event.pointerId, [event.clientX, event.clientY]);
    const active = [...points.current.values()].slice(0, 2);
    const centre = midpoint(active);
    const { x, y } = gesture.current.view;
    const box = event.currentTarget.getBoundingClientRect();
    const dx = centre[0] - gesture.current.centre[0];
    const dy = centre[1] - gesture.current.centre[1];
    if (!moved.current && Math.hypot(dx, dy) < 5 && active.length < 2) return;
    if (!moved.current) {
      moved.current = true;
      setMoving(true);
      for (const id of points.current.keys()) event.currentTarget.setPointerCapture?.(id);
    }
    if (active.length === 2 && gesture.current.distance) {
      const next = zoomAt(gesture.current.view, separation(active) / gesture.current.distance, fromViewCentre(gesture.current.centre, box));
      change({ ...next, x: next.x + dx / units(box), y: next.y + dy / units(box) }, true);
    } else if (gesture.current.pan) {
      change({ ...gesture.current.view, x: x + dx / units(box), y: y + dy / units(box) }, true);
    } else {
      change(orbit(gesture.current.view, -.44 * dx, .27 * dy), true);
    }
  }

  function onPointerEnd(event: PointerEvent<SVGSVGElement>) {
    if (!points.current.delete(event.pointerId)) return;
    if (!points.current.size) setMoving(false);
    start(gesture.current?.pan ?? false);
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.target !== event.currentTarget) return;
    const current = destination.current ?? latest.current;
    let next: FloorView;
    switch (event.key) {
      case "ArrowLeft": next = orbit(current, -15); break;
      case "ArrowRight": next = orbit(current, 15); break;
      case "ArrowUp": next = orbit(current, 0, 6); break;
      case "ArrowDown": next = orbit(current, 0, -6); break;
      case "+": case "=": next = zoomAt(current, 1.2); break;
      case "-": next = zoomAt(current, 1 / 1.2); break;
      case "Home": case "0": next = initialView; break;
      default: return;
    }
    event.preventDefault();
    animate(next);
  }

  return {
    view, moving, animate, moved,
    reset: () => animate(initialView),
    turn: (amount: number) => animate(orbit(destination.current ?? latest.current, amount)),
    zoom: (amount: number) => animate(zoomAt(destination.current ?? latest.current, amount)),
    handlers: { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd,
      onLostPointerCapture: (event: PointerEvent<SVGSVGElement>) => {
        if (event.target === event.currentTarget) onPointerEnd(event);
      }, onPointerLeave: (event: PointerEvent<SVGSVGElement>) => {
        if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) onPointerEnd(event);
      }, onKeyDown },
  };
}
