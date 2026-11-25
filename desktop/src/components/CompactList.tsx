import type { ReactNode } from "react";

/** Keep a useful preview visible; disclose the rest without losing context. */
export function CompactList<T>({ items, render, itemKey, empty, label = "entries" }: {
  items: T[]; render: (item: T) => ReactNode; itemKey: (item: T) => string; empty: string; label?: string;
}) {
  const list = (entries: T[]) => <ul className="p5-list">{entries.map((item) => <li key={itemKey(item)}>{render(item)}</li>)}</ul>;
  return <>
    {items.length ? list(items.slice(0, 3)) : <p className="inspector-empty">{empty}</p>}
    {items.length > 3 && <details className="inspector-more">
      <summary><span className="when-closed">Show {items.length - 3} more {label}</span><span className="when-open">Show fewer {label}</span></summary>
      {list(items.slice(3))}
    </details>}
  </>;
}
