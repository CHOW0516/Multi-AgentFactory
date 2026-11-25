import { defineConfig } from "@playwright/test";

// End-to-end tests run the real desktop app (Electron) against the real stack after the merge.
// Before running: `docker compose up -d`, seed, `npm run build` in desktop/, VITE_USE_MOCKS=false.
// Run from desktop/: `npm run e2e`.
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  // Agents call Claude, so a full PO flow can take a few minutes.
  timeout: 8 * 60 * 1000,
  expect: { timeout: 30 * 1000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  outputDir: "test-results",
  use: { screenshot: "only-on-failure" },
});
