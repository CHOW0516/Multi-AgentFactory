// Electron main process. Security: contextIsolation on, nodeIntegration off, sandbox on.
import { app, BrowserWindow, dialog, ipcMain, net, Notification, protocol, safeStorage, shell } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIR = path.join(__dirname, "..", "dist");
const SECURE_STORE_FILE = () => path.join(app.getPath("userData"), "secure-store.json");

// The production renderer is served from app://./ so the backend can allow the "app://." origin.
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 800,
    title: "Factory Commit",
    backgroundColor: "#f7f7f5",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Open external links in the system browser, never inside the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(window, {
      type: "question", buttons: ["Keep editing", "Discard changes"], defaultId: 0, cancelId: 0,
      title: "Unsaved floor changes", message: "Discard unsaved floor changes and close?",
      detail: "The last saved layout will be kept.",
    });
    if (choice === 1) event.preventDefault();
  });
  if (DEV_SERVER_URL) {
    void window.loadURL(DEV_SERVER_URL);
  } else {
    void window.loadURL("app://./index.html");
  }
}

async function readSecureStore(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fs.readFile(SECURE_STORE_FILE(), "utf8"));
  } catch {
    return {};
  }
}

function registerIpc(): void {
  ipcMain.handle("desktop:notify", (_event, title: string, body: string) => {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  });

  ipcMain.handle("desktop:openFile", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Purchase orders", extensions: ["pdf", "png", "jpg", "jpeg", "docx", "xlsx"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const data = await fs.readFile(filePath);
    return { name: path.basename(filePath), data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
  });

  ipcMain.handle("desktop:secureGet", async (_event, key: string) => {
    const stored = (await readSecureStore())[key];
    if (!stored) return null;
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(stored, "base64"))
      : Buffer.from(stored, "base64").toString("utf8");
  });

  ipcMain.handle("desktop:secureSet", async (_event, key: string, value: string | null) => {
    const store = await readSecureStore();
    if (value === null) {
      delete store[key];
    } else {
      const encrypted = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(value)
        : Buffer.from(value, "utf8");
      store[key] = encrypted.toString("base64");
    }
    await fs.writeFile(SECURE_STORE_FILE(), JSON.stringify(store), { mode: 0o600 });
  });
}

app.whenReady().then(() => {
  protocol.handle("app", (request) => {
    const requestPath = decodeURIComponent(new URL(request.url).pathname);
    const filePath = path.normalize(path.join(RENDERER_DIR, requestPath));
    if (!filePath.startsWith(RENDERER_DIR)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
