import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "../shell/icons";

/** Non-modal, docked scene details: the camera stays usable while inspecting. */
export function Inspector({ title, code, icon, onLocate, onClose, testId, children }: {
  title: string; code?: string; icon: string; onLocate: () => void; onClose: () => void; testId: string; children: ReactNode;
}) {
  const titleId = useId();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus({ preventScroll: true }), []);
  return <section className="floor-inspector floor-panel" role="dialog" aria-labelledby={titleId} data-testid={testId}>
    <header className="floor-inspector-header">
      <span className="floor-tile-icon"><Icon name={icon} size={23} /></span>
      <div className="floor-inspector-title">{code && <span>{code}</span>}<h2 id={titleId}>{title}</h2></div>
      <button type="button" className="icon-button" aria-label={icon === "factory" ? "Focus machine" : "Focus agent"} title="Focus selection" onClick={onLocate}><Icon name="focus" size={17} /></button>
      <button type="button" ref={close} className="icon-button" aria-label="Close details" title="Close details" onClick={onClose}><Icon name="close" size={16} /></button>
    </header>
    <div className="floor-inspector-body">{children}</div>
  </section>;
}
