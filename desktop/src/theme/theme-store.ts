import { create } from "zustand";

export type ThemeName = "light" | "dark";
const STORAGE_KEY = "factory-theme";

function savedTheme(): ThemeName {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
}

interface ThemeState { theme: ThemeName; setTheme(theme: ThemeName): void; toggle(): void }

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: typeof window === "undefined" ? "light" : savedTheme(),
  setTheme(theme) {
    applyTheme(theme);
    try { window.localStorage.setItem(STORAGE_KEY, theme); } catch { /* storage blocked */ }
    set({ theme });
  },
  toggle() {
    get().setTheme(get().theme === "light" ? "dark" : "light");
  },
}));

export function initTheme(): void {
  applyTheme(useThemeStore.getState().theme);
}

/** CSS variable name for a machine status colour, e.g. statusColor("down") -> "var(--status-down)". */
export function statusColor(status: string): string {
  return `var(--status-${status})`;
}
