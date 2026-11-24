// Dev runner: starts the Vite dev server, compiles the Electron main/preload, then launches Electron.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "vite";

const server = await createServer({ configFile: "vite.config.ts" });
await server.listen();
const url = server.resolvedUrls.local[0];

const compile = spawnSync("npx", ["tsc", "-p", "tsconfig.electron.json"], { stdio: "inherit", shell: true });
if (compile.status !== 0) {
  await server.close();
  process.exit(compile.status ?? 1);
}

const electronProcess = spawn("npx", ["electron", "."], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
electronProcess.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
