// Typed access to the Electron preload API (electron/preload.cts).
// In a plain browser (vite dev:web, tests) it falls back to safe stand-ins.

export interface PickedFile { name: string; data: ArrayBuffer }
interface FactoryDesktopApi {
  notify(title: string, body: string): Promise<void>;
  openFile(): Promise<PickedFile | null>;
  secureStore: { get(key: string): Promise<string | null>; set(key: string, value: string | null): Promise<void> };
}

declare global {
  interface Window { factoryDesktop?: FactoryDesktopApi }
}

const browserFallback: FactoryDesktopApi = {
  async notify(title, body) {
    if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body });
  },
  async openFile() {
    return null; // pages should also offer an <input type="file"> or drag and drop
  },
  secureStore: {
    async get(key) {
      try { return window.sessionStorage.getItem(`secure:${key}`); } catch { return null; }
    },
    async set(key, value) {
      try {
        if (value === null) window.sessionStorage.removeItem(`secure:${key}`);
        else window.sessionStorage.setItem(`secure:${key}`, value);
      } catch { /* storage blocked */ }
    },
  },
};

export const desktop: FactoryDesktopApi = typeof window !== "undefined" && window.factoryDesktop
  ? window.factoryDesktop
  : browserFallback;

export const isElectron = typeof window !== "undefined" && Boolean(window.factoryDesktop);
