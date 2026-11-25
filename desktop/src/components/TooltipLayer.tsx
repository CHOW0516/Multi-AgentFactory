import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./TooltipLayer.css";

type Hint = { target: Element; text: string };
const selector = "[data-tooltip], .icon-button[aria-label]";

/** One delegated hint layer serves controls and SVG targets across the application. */
export function TooltipLayer() {
  const id = useId();
  const active = useRef<Hint | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const hoveredPopup = useRef(false);
  const cancelClose = useRef<() => void>(() => undefined);
  const leavePopup = useRef<() => void>(() => undefined);
  const [hint, setHint] = useState<Hint | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useEffect(() => {
    let hovered: Element | null = null;
    let focused: Element | null = null;
    let openTimer: ReturnType<typeof setTimeout> | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    let pointerFocus = false;
    let focusTimer: ReturnType<typeof setTimeout> | undefined;
    const targetOf = (target: EventTarget | null) => target instanceof Element ? target.closest(selector) : null;
    const textOf = (target: Element) => target.getAttribute("data-tooltip") ?? target.getAttribute("aria-label") ?? "";

    function clearTimers() {
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
    }
    function detachDescription() {
      const target = active.current?.target;
      if (!target) return;
      const remaining = (target.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((token) => token && token !== id);
      if (remaining.length) target.setAttribute("aria-describedby", remaining.join(" "));
      else target.removeAttribute("aria-describedby");
    }
    function hide() {
      clearTimers();
      detachDescription();
      active.current = null;
      hoveredPopup.current = false;
      setHint(null);
    }
    function show(target: Element, immediate: boolean) {
      clearTimers();
      const text = textOf(target).trim();
      if (!text || !target.isConnected) { hide(); return; }
      if (active.current?.target === target && active.current.text === text) return;
      const reveal = () => {
        if (!target.isConnected) return;
        detachDescription();
        const next = { target, text };
        const descriptions = (target.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
        if (!descriptions.includes(id)) descriptions.push(id);
        target.setAttribute("aria-describedby", descriptions.join(" "));
        active.current = next;
        setHint(next);
      };
      if (immediate) reveal();
      else openTimer = setTimeout(reveal, 400);
    }
    function scheduleClose() {
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        if (hoveredPopup.current) return;
        if (focused?.isConnected && focused.contains(document.activeElement)) show(focused, true);
        else hide();
      }, 140);
    }
    cancelClose.current = () => clearTimeout(closeTimer);
    leavePopup.current = scheduleClose;

    function onPointerOver(event: PointerEvent) {
      if (event.pointerType === "touch") return;
      const target = targetOf(event.target);
      if (!target || (event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) return;
      hovered = target;
      show(target, false);
    }
    function onPointerOut(event: PointerEvent) {
      const target = targetOf(event.target);
      if (!target || (event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) return;
      hovered = null;
      scheduleClose();
    }
    function onFocusIn(event: FocusEvent) {
      const target = targetOf(event.target);
      focused = target;
      if (target && !pointerFocus) show(target, true);
    }
    function onFocusOut(event: FocusEvent) {
      if (event.relatedTarget instanceof Node && focused?.contains(event.relatedTarget)) return;
      focused = null;
      if (hovered?.isConnected) show(hovered, false);
      else scheduleClose();
    }
    function onPointerDown() {
      pointerFocus = true;
      clearTimeout(focusTimer);
      focusTimer = setTimeout(() => { pointerFocus = false; }, 0);
      hovered = null;
      hide();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && active.current) {
        // Hints are descriptive, not another dialog layer. Preserve the host
        // control's Escape behavior (closing a menu, editor or inspector).
        hide();
      } else if (event.key === "Enter" || event.key === " ") hide();
    }
    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      clearTimers();
      clearTimeout(focusTimer);
      detachDescription();
      active.current = null;
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [id]);

  useLayoutEffect(() => {
    if (!hint || !popup.current) return;
    const anchor = hint.target.getBoundingClientRect();
    const box = popup.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left + (anchor.width - box.width) / 2, window.innerWidth - box.width - 8));
    const below = anchor.bottom + 8;
    const preferredTop = below + box.height <= window.innerHeight - 8 ? below : anchor.top - box.height - 8;
    setPosition({ left, top: Math.max(8, Math.min(preferredTop, window.innerHeight - box.height - 8)) });
  }, [hint]);

  return hint && createPortal(<div ref={popup} id={id} role="tooltip" className="app-tooltip" style={position}
    onPointerEnter={() => { hoveredPopup.current = true; cancelClose.current(); }}
    onPointerLeave={() => { hoveredPopup.current = false; leavePopup.current(); }}>{hint.text}</div>, document.body);
}
