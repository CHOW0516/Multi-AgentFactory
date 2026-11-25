import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type SelectHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../shell/icons";
import "./Select.css";

/** Keep native form/value semantics, but render and control the option menu ourselves. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { children, onChange, onKeyDown, onBlur, disabled, ...props }, forwardedRef,
) {
  const field = useRef<HTMLSelectElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 300 });
  const search = useRef({ value: "", at: 0 });
  useImperativeHandle(forwardedRef, () => field.current!);
  const options = () => Array.from(field.current?.options ?? []);
  const enabled = (index: number) => {
    const option = field.current?.options[index];
    return option && !option.disabled && !(option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled);
  };

  function show(index?: number) {
    if (disabled) return;
    const selected = index ?? field.current?.selectedIndex ?? 0;
    setActive(enabled(selected) ? selected : options().findIndex((_, at) => enabled(at)));
    setOpen(true);
  }
  function close() { setOpen(false); search.current = { value: "", at: 0 }; }
  function choose(index: number) {
    const select = field.current;
    if (!select || !enabled(index)) return;
    // Dispatch the same event callers already handle; form names, validation and
    // dependent selections continue to use a real HTMLSelectElement.
    select.value = select.options[index].value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    close();
    select.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    if (!open || !field.current) return;
    const place = () => {
      const bounds = field.current!.getBoundingClientRect();
      const below = window.innerHeight - bounds.bottom - 14;
      const above = bounds.top - 14;
      const height = Math.min(300, Math.max(below, above));
      const width = Math.min(Math.max(160, bounds.width), window.innerWidth - 16);
      const next = { left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)),
        top: below >= Math.min(240, height) ? bounds.bottom + 6 : Math.max(8, bounds.top - Math.min((popup.current?.scrollHeight ?? height) + 2, height) - 6),
        width, maxHeight: Math.max(48, height) };
      setPosition((previous) => Object.keys(next).every((key) => previous[key as keyof typeof previous] === next[key as keyof typeof next]) ? previous : next);
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !field.current?.contains(event.target) && !popup.current?.contains(event.target)) close();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); field.current?.focus({ preventScroll: true }); }
    };
    const scroll = (event: Event) => { if (!(event.target instanceof Node && popup.current?.contains(event.target))) close(); };
    place();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [open, position.width, children]);
  useEffect(() => {
    if (disabled) close();
  }, [disabled]);
  useEffect(() => {
    if (open) popup.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);

  function keyDown(event: KeyboardEvent<HTMLSelectElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const list = options();
    const available = list.map((_, index) => index).filter(enabled);
    const current = open ? active : field.current?.selectedIndex ?? -1;
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      let next = current;
      if (event.key === "Home") next = available[0];
      else if (event.key === "End") next = available.at(-1)!;
      else if (open) {
        const at = available.indexOf(current);
        next = available[Math.max(0, Math.min(available.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))];
      }
      if (open) setActive(next); else show(next);
    } else if (event.key === "F4") {
      event.preventDefault();
      if (open) close(); else show();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(active); else show();
    } else if (event.key === "Tab") close();
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const value = (now - search.current.at > 700 ? "" : search.current.value) + event.key.toLocaleLowerCase();
      search.current = { value, at: now };
      const repeated = [...value].every((letter) => letter === value[0]);
      const prefix = repeated ? value[0] : value;
      const ordered = [...available.filter((index) => index > current), ...available.filter((index) => index <= current)];
      const next = ordered.find((index) => list[index].text.trim().toLocaleLowerCase().startsWith(prefix));
      if (next !== undefined) { if (open) setActive(next); else show(next); }
    }
  }

  const list = options();
  const selected = props.value !== undefined ? list.findIndex((option) => option.value === String(props.value)) : field.current?.selectedIndex;
  return <span className="themed-select">
    <select {...props} ref={field} disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
      aria-controls={open ? menuId : undefined} aria-activedescendant={open && active >= 0 ? `${menuId}-${active}` : undefined}
      onChange={(event) => { onChange?.(event); close(); }} onKeyDown={keyDown}
      onPointerDown={(event) => { if (event.button === 0) { event.preventDefault(); field.current?.focus({ preventScroll: true }); if (open) close(); else show(); } }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => { event.preventDefault(); if (event.detail === 0) { if (open) close(); else show(); } }}
      onBlur={(event) => { onBlur?.(event); close(); }}>
      {children}
    </select>
    <Icon name="chevron-down" size={15} />
    {open && createPortal(<div ref={popup} id={menuId} role="listbox" className="select-menu"
      aria-label={props["aria-label"] ?? field.current?.labels?.[0]?.textContent ?? "Options"} style={position}>
      {list.map((option, index) => <div key={`${option.value}-${index}`} id={`${menuId}-${index}`} role="option"
        aria-selected={index === selected} aria-disabled={!enabled(index) || undefined} className="select-option"
        data-index={index} data-active={index === active || undefined}
        onPointerMove={() => { if (enabled(index)) setActive(index); }}
        onPointerDown={(event) => event.preventDefault()} onClick={() => choose(index)}>
        <span>{option.text}</span>{index === selected && <Icon name="approvals" size={15} />}
      </div>)}
      {!list.length && <div className="select-empty">No options available.</div>}
    </div>, document.body)}
  </span>;
});
