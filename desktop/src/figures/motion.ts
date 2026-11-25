import { useEffect, useRef, useState, type RefObject } from "react";

const reducedQuery = "(prefers-reduced-motion: reduce)";

export function useMotionVisibility(ref: RefObject<Element>) {
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  const [onscreen, setOnscreen] = useState(() => typeof IntersectionObserver === "undefined");
  const [reduced, setReduced] = useState(() => window.matchMedia?.(reducedQuery)?.matches ?? false);

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState !== "hidden");
    const media = window.matchMedia?.(reducedQuery);
    const onPreference = () => setReduced(media?.matches ?? false);
    document.addEventListener("visibilitychange", onVisibility);
    media?.addEventListener("change", onPreference);
    const observer = typeof IntersectionObserver === "undefined" ? null :
      new IntersectionObserver(([entry]) => setOnscreen(entry.isIntersecting));
    if (ref.current) observer?.observe(ref.current);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      media?.removeEventListener("change", onPreference);
    };
  }, [ref]);
  return { visible: visible && onscreen, reduced };
}

export function useFigureFrames(running: boolean, draw: (time: number, delta: number) => void) {
  const latest = useRef(draw);
  const elapsed = useRef(0);
  latest.current = draw;
  useEffect(() => {
    if (!running) return;
    let last: number | undefined;
    let frame = requestAnimationFrame(tick);
    function tick(now: number) {
      if (document.visibilityState === "hidden") return;
      const delta = last === undefined ? 0 : Math.min(100, now - last);
      last = now;
      elapsed.current += delta;
      latest.current(elapsed.current, delta);
      frame = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(frame);
  }, [running]);
}
