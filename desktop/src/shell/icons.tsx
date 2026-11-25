// Small inline icon set (no icon library). Pages pick one by name in route.tsx.
const PATHS: Record<string, string> = {
  factory: "M3 21V10l5 3V10l5 3V6l8 4v11H3zm4-4h2m4 0h2",
  approvals: "M9 12l2 2 4-4M12 3a9 9 0 100 18 9 9 0 000-18z",
  orders: "M7 3h10l2 4v14H5V7l2-4zm-2 4h14M9 11h6M9 15h6",
  schedule: "M4 5h16v15H4zM4 9h16M8 3v4m8-4v4M8 13h3v3H8z",
  materials: "M3 7l9-4 9 4-9 4-9-4zm0 0v10l9 4 9-4V7M12 11v10",
  quotations: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h4",
  dashboards: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  agents: "M12 9a3 3 0 100-6 3 3 0 000 6zm-7 12a3 3 0 100-6 3 3 0 000 6zm14 0a3 3 0 100-6 3 3 0 000 6zM12 9v4m0 0l-5 3m5-3l5 3",
  quality: "M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3zm-3 9l2 2 4-4",
  history: "M3 12a9 9 0 103-6.7M3 4v4h4m5-1v5l3 3",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zm7-3l2-1-1-3-2 .2-1.2-1.6.4-2-3-1-1 1.8h-2L9.2 3.6l-3 1 .4 2L5.4 8 3.4 7.9l-1 3 2 1v2l-2 1 1 3 2-.2 1.2 1.6-.4 2 3 1 1-1.8h2l1 1.8 3-1-.4-2 1.2-1.6 2 .2 1-3-2-1z",
  bell: "M6 16V11a6 6 0 1112 0v5l2 2H4l2-2zm4 4h4",
  chat: "M4 5h16v11H9l-5 4V5z",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
  sun: "M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2m0 18v2M4.2 4.2l1.4 1.4m12.8 12.8l1.4 1.4M1 12h2m18 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 13A9 9 0 1111 3a7 7 0 0010 10z",
  dot: "M12 10a2 2 0 100 4 2 2 0 000-4z",
  sidebar: "M4 5h16v14H4z M9 5v14 M6.5 8.5h.1m-.1 3h.1m-.1 3h.1",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  "rotate-left": "M5 10a7 7 0 1 1 .9 7.9M5 5v5h5",
  "rotate-right": "M19 10a7 7 0 1 0-.9 7.9M19 5v5h-5",
  home: "m4 11 8-7 8 7m-2-1v9H6v-9m4 9v-5h4v5",
  orbit: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-4.6-3.4L14 14l-5.4 1.4L10 10z",
  focus: "M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5m-3-11a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  close: "m6 6 12 12M6 18 18 6",
  search: "M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm4.5 10.5 4.5 4.5",
  "chevron-down": "m6 9 6 6 6-6",
  "chevron-up": "m6 15 6-6 6 6",
  "chevron-right": "m9 6 6 6-6 6",
  "chevron-left": "m15 6-6 6 6 6",
  clock: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 4v4l3 2",
};

export function Icon({ name, size = 18, title }: { name: string; size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name] ?? PATHS.dot} />
    </svg>
  );
}

export const ICON_NAMES = Object.keys(PATHS);
