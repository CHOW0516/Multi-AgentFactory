import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { Page } from "../api/types";
import { Plate } from "../iso/react/draw";
import { useThemeStore } from "../theme/theme-store";
import "../iso/iso.css";
import "./figures.css";

export function FigurePage({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const theme = useThemeStore((state) => state.theme);
  return <section className="p5-page iso" data-theme={theme}>
    <header className="p5-heading">
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
    {children}
  </section>;
}

export function FigureCard({ number, title, hint, readout, caption, children }: {
  number: number; title: string; hint: string; readout: ReactNode; caption?: ReactNode; children: ReactNode;
}) {
  return <Plate fig={`Fig ${number}`} title={title} hint={hint} readout={readout} caption={caption}>{children}</Plate>;
}

export function Metrics({ items }: { items: [string, ReactNode][] }) {
  return <dl className="p5-metrics">{items.map(([label, value]) =>
    <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

export function Drawer({ title, onClose, children, testId }: { title: string; onClose: () => void; children: ReactNode; testId?: string }) {
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog?.showModal) dialog.showModal();
    else dialog?.setAttribute("open", "");
    return () => {
      if (dialog?.close) dialog.close();
      else dialog?.removeAttribute("open");
    };
  }, []);
  return <dialog ref={ref} aria-labelledby={id} className="p5-drawer" data-testid={testId} onCancel={(event) => {
    event.preventDefault();
    onClose();
  }} onClick={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <div className="p5-drawer-body">
      <header>
        <h2 id={id}>{title}</h2>
        <button type="button" className="icon-button" aria-label="Close details" onClick={onClose}>×</button>
      </header>
      {children}
    </div>
  </dialog>;
}

export function QueryNotice({ pending, error, retry }: { pending: boolean; error: boolean; retry: () => void }) {
  if (pending) return <p className="p5-notice" role="status">Loading…</p>;
  if (!error) return null;
  return <div className="p5-notice" role="alert">Could not load this data. <button className="button" onClick={retry}>Retry</button></div>;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const percentFormat = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });
export const formatDateTime = (value: string) => dateFormat.format(new Date(value));
export const percent = (value: number) => percentFormat.format(value);

export const itemsOf = <T,>(response: T[] | Page<T>) => Array.isArray(response) ? response : response.items;

export function activateOnKey(event: KeyboardEvent, select: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  select();
}
