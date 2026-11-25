import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../shell/icons";
import "./TimePicker.css";

type TimePickerProps = {
  id?: string; value: string; onChange: (value: string) => void; min?: string; max?: string;
  "aria-label"?: string; required?: boolean; disabled?: boolean;
};
type Part = "hours" | "minutes";
const pad = (value: number) => String(value).padStart(2, "0");
const isTime = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const numbers = { hours: Array.from({ length: 24 }, (_, hour) => hour), minutes: Array.from({ length: 60 }, (_, minute) => minute) };

/** Local wall-clock time, kept as HH:mm throughout; no date or timezone conversion. */
export function TimePicker({ id, value, onChange, min, max, "aria-label": label, required, disabled }: TimePickerProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const popupId = `${fieldId}-time-picker`;
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLSpanElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [pending, setPending] = useState(isTime(value) ? value : "08:00");
  const [part, setPart] = useState<Part>("hours");
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [fieldLabel, setFieldLabel] = useState(label ?? "time");
  useLayoutEffect(() => {
    setFieldLabel(label ?? input.current?.labels?.[0]?.textContent?.trim() ?? "time");
  }, [fieldId, label]);
  const valid = (time: string) => isTime(time) && (!min || time >= min) && (!max || time <= max);
  const hour = Number(pending.slice(0, 2));
  const minute = Number(pending.slice(3, 5));
  const candidate = (axis: Part, number: number) => axis === "hours" ? `${pad(number)}:${pad(minute)}` : `${pad(hour)}:${pad(number)}`;
  const available = (axis: Part, number: number) => axis === "minutes" ? valid(candidate(axis, number)) :
    (!min || `${pad(number)}:59` >= min) && (!max || `${pad(number)}:00` <= max);
  function choosePart(axis: Part, number: number) {
    if (!available(axis, number)) return;
    const time = candidate(axis, number);
    setPart(axis); setPending(min && time < min ? min : max && time > max ? max : time);
  }

  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    const field = input.current;
    if (!field) return;
    field.setCustomValidity(draft && !valid(draft) ? "Enter a valid time in HH:mm format within the allowed range." : "");
    const form = field.form;
    const validate = (event: Event) => {
      if (!field.checkValidity()) { event.preventDefault(); event.stopPropagation(); field.reportValidity(); }
    };
    form?.addEventListener("submit", validate, true);
    return () => form?.removeEventListener("submit", validate, true);
  }, [draft, min, max, required]);

  function close(returnFocus = true) { setOpen(false); if (returnFocus) input.current?.focus(); }
  function show() {
    const next = valid(value) ? value : min && valid(min) ? min : max && valid(max) ? max : "08:00";
    setPending(next); setPart("hours"); setOpen(true);
  }
  function commit(time = pending) {
    onChange(time); setDraft(time); close();
  }

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;
      const height = popup.current?.getBoundingClientRect().height || 342;
      const width = Math.min(292, window.innerWidth - 16);
      const next = { left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: rect.bottom + height + 7 <= window.innerHeight ? rect.bottom + 7 : Math.max(8, rect.top - height - 7) };
      setPosition((previous) => previous.left === next.left && previous.top === next.top ? previous : next);
    }
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target) && !popup.current?.contains(event.target)) close(false);
    }
    function escape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    }
    function focusOutside(event: FocusEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target) && !popup.current?.contains(event.target)) close(false);
    }
    place();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    document.addEventListener("focusin", focusOutside);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("focusin", focusOutside);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const selected = popup.current?.querySelector<HTMLButtonElement>(`[data-part="${part}"][aria-selected="true"]`);
    selected?.focus({ preventScroll: true });
    popup.current?.querySelectorAll<HTMLButtonElement>('[aria-selected="true"]').forEach((option) => {
      option.scrollIntoView?.({ block: "nearest" });
    });
  }, [open, pending, part]);

  function navigate(event: KeyboardEvent<HTMLButtonElement>, axis: Part, number: number) {
    let next = number;
    const limit = numbers[axis].length;
    switch (event.key) {
      case "ArrowUp": next = (number + limit - 1) % limit; break;
      case "ArrowDown": next = (number + 1) % limit; break;
      case "Home": next = 0; break;
      case "End": next = limit - 1; break;
      case "PageUp": next = Math.max(0, number - 10); break;
      case "PageDown": next = Math.min(limit - 1, number + 10); break;
      case "ArrowLeft": case "ArrowRight": event.preventDefault(); setPart(axis === "hours" ? "minutes" : "hours"); return;
      default: return;
    }
    event.preventDefault();
    if (event.key === "Home" || event.key === "End") {
      const choices = numbers[axis].filter((entry) => available(axis, entry));
      next = event.key === "Home" ? choices[0] ?? number : choices.at(-1) ?? number;
    } else {
      const direction = event.key === "ArrowUp" || event.key === "PageUp" ? -1 : 1;
      for (let attempts = 0; attempts < limit && !available(axis, next); attempts++) next = (next + direction + limit) % limit;
    }
    choosePart(axis, next);
  }

  return <span className="time-picker" ref={root}>
    <input ref={input} id={fieldId} type="text" inputMode="numeric" autoComplete="off" placeholder="HH:mm"
      value={draft} required={required} disabled={disabled} aria-label={label} aria-haspopup="dialog"
      aria-expanded={open} aria-controls={open ? popupId : undefined} aria-invalid={Boolean(draft && !valid(draft)) || undefined}
      onChange={(event) => { const next = event.target.value; setDraft(next); if (!next || valid(next)) onChange(next); }}
      onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); show(); } }} />
    <button className="icon-button time-picker-trigger" type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={open}
      aria-label={`Choose ${fieldLabel}`}
      onClick={() => open ? close() : show()}><Icon name="clock" size={16} /></button>
    {open && createPortal(<div ref={popup} id={popupId} role="dialog" aria-label="Choose time" className="time-picker-popup" style={position}>
      <header className="time-picker-heading"><span><Icon name="clock" size={17} /><strong>Choose time</strong></span><output aria-live="polite">{pending}</output></header>
      <div className="time-picker-columns">{(["hours", "minutes"] as const).map((axis) => <div key={axis} className="time-picker-column">
        <span id={`${popupId}-${axis}`}>{axis === "hours" ? "Hour" : "Minute"}</span>
        <div role="listbox" aria-labelledby={`${popupId}-${axis}`} className="time-picker-options">
          {numbers[axis].map((number) => {
            const selected = number === (axis === "hours" ? hour : minute);
            const blocked = !available(axis, number);
            return <button type="button" role="option" key={number} data-part={axis} aria-selected={selected}
              aria-disabled={blocked || undefined} tabIndex={selected ? 0 : -1}
              onKeyDown={(event) => navigate(event, axis, number)}
              onClick={() => choosePart(axis, number)}>{pad(number)}</button>;
          })}
        </div>
      </div>)}</div>
      <footer><span>24-hour time</span><button type="button" className="button button-small" onClick={() => close()}>Cancel</button>
        <button type="button" className="button button-small button-primary" disabled={!valid(pending)} onClick={() => commit()}>Set time</button></footer>
    </div>, document.body)}
  </span>;
}
