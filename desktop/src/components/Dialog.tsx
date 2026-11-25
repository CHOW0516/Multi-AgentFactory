import "./components.css";
// Modal dialog and a slide-in drawer. Escape closes both; focus moves into them when they open.
import { useEffect, useRef, type ReactNode } from "react";

function useEscapeAndFocus(open: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusable = panelRef.current?.querySelector<HTMLElement>("input, textarea, select, button");
    focusable?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previousFocus?.focus?.();
    };
  }, [open, onClose]);
  return panelRef;
}

export function Dialog({ open, title, onClose, children, footer, testId }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; testId?: string;
}) {
  const panelRef = useEscapeAndFocus(open, onClose);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="dialog card" role="dialog" aria-modal="true" aria-label={title} ref={panelRef} data-testid={testId}>
        <h2>{title}</h2>
        <div className="dialog-body">{children}</div>
        {footer ? <div className="dialog-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", danger, onConfirm, onClose }: {
  open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean;
  onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Dialog open={open} title={title} onClose={onClose} footer={
      <>
        <button type="button" className="button" onClick={onClose}>Cancel</button>
        <button type="button" className={danger ? "button button-danger" : "button button-primary"} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </>
    }>
      {message}
    </Dialog>
  );
}

export function Drawer({ open, title, onClose, children, testId, wide }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; testId?: string; wide?: boolean;
}) {
  const panelRef = useEscapeAndFocus(open, onClose);
  if (!open) return null;
  return (
    <div className="overlay overlay-drawer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className={`drawer${wide ? " drawer-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}
        ref={panelRef} data-testid={testId}>
        <div className="drawer-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}
