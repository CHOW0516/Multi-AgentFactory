import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../shell/icons";

export function LineContextMenu({ x, y, kind, onDelete, onClose }: {
  x: number; y: number; kind: "block" | "link"; onDelete(): void; onClose(restoreFocus?: boolean): void;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const box = popup.current?.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(x, window.innerWidth - (box?.width || 190) - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - (box?.height || 48) - 8)) });
    popup.current?.querySelector("button")?.focus({ preventScroll: true });
  }, [x, y]);
  useEffect(() => {
    const outside = (event: globalThis.PointerEvent) => { if (event.target instanceof Node && !popup.current?.contains(event.target)) onClose(); };
    const close = () => onClose();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [onClose]);
  return createPortal(<div ref={popup} role="menu" aria-label="Element actions" className="ls-context-menu" style={position}
    onContextMenu={(event) => event.preventDefault()} onKeyDown={(event) => {
      if (event.key === "Escape" || event.key === "Tab") { onClose(true); if (event.key === "Escape") event.preventDefault(); }
      if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) event.preventDefault();
    }}>
    <button type="button" role="menuitem" className="ls-context-delete" onClick={onDelete}>
      <Icon name="close" size={16} />Delete {kind === "block" ? "block" : "connection"}<kbd>Del</kbd>
    </button>
  </div>, document.body);
}
