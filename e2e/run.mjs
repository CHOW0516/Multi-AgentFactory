// Runs the e2e tests with desktop/node_modules on the module path, so files in e2e/ can import
// "@playwright/test" (it is installed in desktop/, not at the repository root). Works on Windows too.
// Usage from desktop/: npm run e2e [-- extra playwright arguments]
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const e2eDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopModules = path.resolve(e2eDirectory, "..", "desktop", "node_modules");
const playwrightCli = path.join(desktopModules, "@playwright", "test", "cli.js");

const result = spawnSync(
  process.execPath,
  [playwrightCli, "test", "--config", path.join(e2eDirectory, "playwright.config.ts"), "--trace", "off", ...process.argv.slice(2)],
  { stdio: "inherit", env: { ...process.env, NODE_PATH: desktopModules } },
);
process.exit(result.status ?? 1);
