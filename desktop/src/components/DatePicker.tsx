import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../shell/icons";
import "./components.css";

type DatePickerProps = {
  id?: string; value: string; onChange: (value: string) => void; min?: string; max?: string;
  "aria-label"?: string; required?: boolean; disabled?: boolean;
};

const isoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
function readDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  return isoDate(date) === value ? date : null;
}
const shiftDate = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);

/** A typed ISO date field with an app-themed, keyboard-operable calendar. */
export function DatePicker({ id, value, onChange, min, max, "aria-label": label, required, disabled }: DatePickerProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const popupId = `${inputId}-calendar`;
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLSpanElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(() => value || isoDate(new Date()));
  const [month, setMonth] = useState(() => readDate(value) ?? new Date());
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [fieldLabel, setFieldLabel] = useState(label ?? "date");
  useLayoutEffect(() => {
    setFieldLabel(label ?? input.current?.labels?.[0]?.textContent?.trim() ?? "date");
  }, [inputId, label]);
  const today = isoDate(new Date());
  const valid = (day: string) => Boolean(readDate(day)) && (!min || day >= min) && (!max || day <= max);

  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    const field = input.current;
    if (!field) return;
    const invalid = Boolean(draft && (!readDate(draft) || (min && draft < min) || (max && draft > max)));
    field.setCustomValidity(invalid ? "Enter a valid date in YYYY-MM-DD format within the allowed range." : "");
    // Some application forms do their own validation with noValidate. A typed
    // invalid date must still prevent submitting the previous valid value.
    const form = field.form;
    const validate = (event: Event) => {
      if (!field.checkValidity()) { event.preventDefault(); event.stopPropagation(); field.reportValidity(); }
    };
    form?.addEventListener("submit", validate, true);
    return () => form?.removeEventListener("submit", validate, true);
  }, [draft, min, max, required]);
  useEffect(() => {
    if (!open) return;
    function place() {
      const rect = root.current?.getBoundingClientRect();
      if (rect) setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 302)),
        top: rect.bottom + 354 <= window.innerHeight ? rect.bottom + 7 : Math.max(8, rect.top - 354) });
    }
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target) && !popup.current?.contains(event.target)) setOpen(false);
    }
    function escape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); input.current?.focus(); }
    }
    place();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  useEffect(() => {
    if (open) popup.current?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)?.focus();
  }, [open, focused, month]);

  function show() {
    const day = valid(value) ? value : valid(today) ? today : min ?? max ?? today;
    setFocused(day); setMonth(readDate(day) ?? new Date()); setOpen(true);
  }
  function choose(day: string) {
    onChange(day); setDraft(day); setOpen(false); input.current?.focus();
  }
  function moveMonth(amount: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + amount, 1, 12);
    setMonth(next); setFocused(isoDate(next));
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, day: Date) {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7,
      Home: -(day.getDay() + 6) % 7, End: 6 - (day.getDay() + 6) % 7 };
    let next: Date;
    if (event.key in offsets) next = shiftDate(day, offsets[event.key]);
    else if (event.key === "PageUp" || event.key === "PageDown") next = new Date(day.getFullYear(), day.getMonth() + (event.key === "PageUp" ? -1 : 1), 1, 12);
    else if (event.key === "Tab") { setOpen(false); input.current?.focus(); return; }
    else return;
    event.preventDefault(); setFocused(isoDate(next)); setMonth(next);
  }
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const start = shiftDate(first, -(first.getDay() + 6) % 7);
  const days = Array.from({ length: 42 }, (_, index) => shiftDate(start, index));
  const monthLabel = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(month);
  const dayLabel = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });

  return <span ref={root} className="date-picker">
    <input ref={input} id={inputId} type="text" inputMode="numeric" autoComplete="off" placeholder="YYYY-MM-DD"
      aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popupId : undefined}
      aria-invalid={Boolean(draft && !valid(draft)) || undefined} required={required} disabled={disabled}
      value={draft} onChange={(event) => {
        const next = event.target.value; setDraft(next);
        if (!next || valid(next)) onChange(next);
      }}
      onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); show(); } }} />
    <button className="icon-button date-picker-trigger" type="button" disabled={disabled}
      aria-label={`Choose ${fieldLabel}`} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => open ? setOpen(false) : show()}><Icon name="schedule" size={16} /></button>
    {open && createPortal(<div ref={popup} id={popupId} role="dialog" aria-label="Choose date" className="date-calendar"
      style={position}>
      <header className="date-calendar-heading">
        <span className="date-calendar-title"><Icon name="schedule" size={17} /><strong aria-live="polite">{monthLabel}</strong></span>
        <button type="button" className="icon-button" aria-label="Previous month" onClick={() => moveMonth(-1)}><Icon name="chevron-left" size={16} /></button>
        <button type="button" className="icon-button" aria-label="Next month" onClick={() => moveMonth(1)}><Icon name="chevron-right" size={16} /></button>
      </header>
      <div className="date-calendar-week" aria-hidden="true">{["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="date-calendar-days" role="group" aria-label={monthLabel}>{days.map((day) => {
        const iso = isoDate(day);
        return <button key={iso} type="button" data-date={iso} data-outside={day.getMonth() !== month.getMonth() || undefined}
          data-today={iso === today || undefined} aria-label={dayLabel.format(day)} aria-pressed={iso === value}
          aria-current={iso === today ? "date" : undefined} aria-disabled={!valid(iso) || undefined}
          tabIndex={iso === focused ? 0 : -1} onKeyDown={(event) => navigate(event, day)}
          onClick={() => { if (valid(iso)) choose(iso); }}>{day.getDate()}</button>;
      })}</div>
      <footer><button type="button" className="link-button" disabled={!valid(today)} onClick={() => choose(today)}>Today</button>
        <span>YYYY-MM-DD</span>{!required && <button type="button" className="link-button" onClick={() => choose("")}>Clear</button>}</footer>
    </div>, document.body)}
  </span>;
}
