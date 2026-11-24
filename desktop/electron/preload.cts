// The only bridge between the web page and Electron. Keep it small.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("factoryDesktop", {
  notify: (title: string, body: string): Promise<void> => ipcRenderer.invoke("desktop:notify", title, body),
  openFile: (): Promise<{ name: string; data: ArrayBuffer } | null> => ipcRenderer.invoke("desktop:openFile"),
  secureStore: {
    get: (key: string): Promise<string | null> => ipcRenderer.invoke("desktop:secureGet", key),
    set: (key: string, value: string | null): Promise<void> => ipcRenderer.invoke("desktop:secureSet", key, value),
  },
});
