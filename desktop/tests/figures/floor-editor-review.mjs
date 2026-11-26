import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

// Run against a VITE_USE_MOCKS=true dev server. Exercises actual pointer capture and SVG hit testing.
const output = resolve("dist/floor-editor-qa");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 970 }, reducedMotion: "reduce" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.setDefaultTimeout(15000);
const url = process.env.P5_URL ?? "http://127.0.0.1:5174";
const shot = (name) => page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
const api = (path) => page.evaluate(async (endpoint) => {
  const { apiFetch } = await import("/src/api/client.ts");
  return apiFetch(endpoint);
}, path);
async function login(role) {
  await page.goto(url);
  await page.getByLabel("Email").fill(`${role}@factory.local`);
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.getByRole("heading", { name: "Factory floor", exact: true }).waitFor();
}
async function cell(x, y, layout) {
  return page.locator(".floor-model").evaluate((svg, { x, y, layout }) => {
    const a = Number(svg.dataset.azimuth) * Math.PI / 180;
    const e = Number(svg.dataset.elevation) * Math.PI / 180;
    const k = .73 * Math.sqrt(1.6);
    const cx = (501 * Math.sin(a) - 320 * Math.cos(a)) * k;
    const cy = ((501 * Math.cos(a) + 320 * Math.sin(a)) * Math.sin(e) - 20 * Math.cos(e)) * k;
    const wx = layout.origin_x + (x + .5) * 10, wy = layout.origin_y + (y + .5) * 10;
    const point = new DOMPoint(620 - cx + (wx * Math.sin(a) - wy * Math.cos(a)) * k,
      367 - cy + (wx * Math.cos(a) + wy * Math.sin(a)) * Math.sin(e) * k)
      .matrixTransform(svg.querySelector(":scope > g").getScreenCTM());
    return { x: point.x, y: point.y };
  }, { x, y, layout });
}
async function mouseCell(x, y, layout) { const point = await cell(x, y, layout); await page.mouse.move(point.x, point.y); return point; }
async function clickCell(x, y, layout) { const point = await mouseCell(x, y, layout); await page.mouse.click(point.x, point.y); }

try {
  await login("admin");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Machines", exact: true }).click();
  const shortcut = page.getByRole("link", { name: "Edit floor layout", exact: true });
  await expect(shortcut).toHaveCSS("text-decoration-line", "none");
  const shortcutWidth = (await shortcut.boundingBox()).width;
  assert(shortcutWidth < 300, "the edit action should fit its content");
  await shot("settings-machines-light");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await shot("settings-machines-dark");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await shortcut.click();
  await page.getByRole("button", { name: "Add Work table", exact: true }).waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const collapse = page.getByRole("button", { name: "Collapse sidebar" });
  if (await collapse.isVisible()) await collapse.click();
  await page.getByRole("button", { name: "Edit floor", exact: true }).click();
  await page.getByRole("heading", { name: "Edit floor", exact: true }).waitFor();
  const initial = await api("/floor/layout");
  const scene = page.locator(".floor-model");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await expect(page.locator(".floor-edit-grid")).toBeVisible();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(scene).toHaveAttribute("data-zoom", "1.22");
  await page.getByRole("button", { name: "Reset camera", exact: true }).click();
  await expect(scene).toHaveAttribute("data-zoom", "1.00");
  await shot("editor-initial-light");

  await page.getByRole("button", { name: "Add Work table", exact: true }).click();
  await mouseCell(initial.machines[0].x + 1, initial.machines[0].y + 1, initial);
  await expect(page.locator('[data-placement-valid="false"]')).toBeVisible();
  await clickCell(initial.machines[0].x + 1, initial.machines[0].y + 1, initial);
  assert.equal(await page.locator("[data-machine]").count(), initial.machines.length, "invalid placement must not move or remove an existing machine");
  await mouseCell(65, 72, initial);
  await expect(page.locator('[data-placement-valid="true"]')).toBeVisible();
  await clickCell(65, 72, initial);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Work table");
  const table = page.getByRole("button", { name: "Work table", exact: true });
  const tableId = await table.getAttribute("data-floor-item");
  const originalPosition = await table.getAttribute("transform");
  await mouseCell(66, 73, initial);
  await page.mouse.down();
  const destination = await cell(71, 73, initial);
  await page.mouse.move(destination.x, destination.y, { steps: 8 });
  await page.mouse.up();
  const movedPosition = await table.getAttribute("transform");
  assert.notEqual(movedPosition, originalPosition);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(table).toHaveAttribute("transform", originalPosition);
  await scene.focus(); await page.keyboard.press("Control+y");
  await expect(table).toHaveAttribute("transform", movedPosition);
  await page.getByRole("button", { name: "Rotate 90°", exact: true }).click();
  await expect(page.getByText("Rotation: 90°", { exact: true })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Assembly table");
  await page.getByLabel("Name", { exact: true }).press("Tab");

  await page.getByRole("button", { name: "Add Cnc Mill", exact: true }).click();
  await clickCell(70, 85, initial);
  await expect(page.getByRole("button", { name: "Cnc Mill, Idle", exact: true })).toBeVisible();
  await expect(page.getByLabel("Machine code", { exact: true })).toHaveValue("CNCMILL-1");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await page.locator("[data-machine]").count(), initial.machines.length);

  const chairTarget = await cell(80, 70, initial);
  const sceneBox = await scene.boundingBox();
  await page.getByRole("button", { name: "Add Chair", exact: true }).dragTo(scene,
    { targetPosition: { x: chairTarget.x - sceneBox.x, y: chairTarget.y - sceneBox.y } });
  await expect(page.getByRole("button", { name: "Chair", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Chair", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Add Wall run", exact: true }).click();
  await mouseCell(57, 55, initial); await page.mouse.down();
  const wallEnd = await cell(63, 55, initial);
  await page.mouse.move(wallEnd.x, wallEnd.y, { steps: 10 }); await page.mouse.up();
  await expect(page.getByLabel("Wall length (cells)")).toHaveValue("7");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Wall run", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Wall run", exact: true })).toHaveCount(1);

  await page.getByLabel("Width (cells)", { exact: true }).fill("30");
  await page.getByRole("button", { name: "Resize floor", exact: true }).click();
  await expect(page.getByText(/Resize blocked/)).toBeVisible();
  await page.getByLabel("Width (cells)", { exact: true }).fill("140");
  await page.getByRole("button", { name: "Resize floor", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Width (cells)", { exact: true })).toHaveValue("137");
  await page.getByRole("button", { name: "Redo", exact: true }).click();

  await page.getByRole("button", { name: "Assembly table", exact: true }).focus(); await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.locator(`[data-floor-item="${tableId}"]`)).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
  const saved = await api("/floor/layout");
  assert.equal(saved.columns, 140);
  assert.equal(saved.machines.length, 8);
  assert.deepEqual(saved.decor.find((item) => item.id === tableId), { id: tableId, kind: "table", name: "Assembly table", x: 70, y: 72, rotation: 90, width: 9, height: 5 });
  await shot("editor-saved-light");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await shot("editor-saved-dark");
  await page.getByRole("button", { name: "Switch to light theme" }).click();

  await page.getByRole("button", { name: /^CNC Lathe 2,/ }).focus(); await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
  assert.equal((await api("/floor/layout")).machines.length, 7);
  assert.equal((await api("/machines")).length, 8);
  await expect(page.getByRole("button", { name: "Place LATHE-02", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit floor", exact: true })).toBeVisible();
  assert.equal(await page.locator("[data-machine]").count(), 7);

  await page.getByRole("button", { name: "Edit floor", exact: true }).click();
  await page.getByRole("button", { name: "Add Chair", exact: true }).click();
  await clickCell(80, 70, saved);
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  const warning = page.getByRole("dialog", { name: "Discard unsaved floor changes?" });
  await expect(warning).toBeVisible();
  await warning.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit floor", exact: true })).toBeVisible();
  let closeWarning = false;
  page.once("dialog", async (dialog) => { closeWarning = dialog.type() === "beforeunload"; await dialog.dismiss(); });
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => closeWarning).toBe(true);
  assert.equal(page.isClosed(), false);
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await warning.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();
  assert.deepEqual(errors, []);

  await context.close();
  const viewer = await browser.newPage();
  await viewer.goto(url);
  await viewer.getByLabel("Email").fill("manager@factory.local"); await viewer.getByLabel("Password").fill("demo");
  await viewer.getByRole("button", { name: "Log in", exact: true }).click();
  await viewer.getByRole("heading", { name: "Factory floor", exact: true }).waitFor();
  await expect(viewer.getByRole("button", { name: "Edit floor", exact: true })).toHaveCount(0);
  console.log("Passed browser checks: admin gating, invalid/valid ghosts, add, drag, rotate, wall run, resize clipping, history, properties, Save, layout-only removal, Cancel, navigation and native close warnings, light/dark rendering.");
} catch (error) {
  if (!page.isClosed()) await shot("failure");
  throw error;
} finally { await browser.close(); }
