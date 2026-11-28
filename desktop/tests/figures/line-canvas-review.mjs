import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

// Run against a VITE_USE_MOCKS=true dev server. Uses real SVG matrices and pointer capture.
const browser = await chromium.launch({ headless: true });
const output = resolve("dist/line-canvas-qa");
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.P5_URL ?? "http://127.0.0.1:5175");
  await page.getByLabel("Email").fill("planner@factory.local");
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.getByRole("link", { name: "Line simulator", exact: true }).click();
  const canvas = page.getByTestId("line-canvas");
  const source = canvas.locator(".ls-source");
  const sink = canvas.locator(".ls-sink");
  await source.waitFor();
  await source.click();
  await expect(source).toHaveCSS("outline-style", "none");
  await expect(source.locator(".ls-block-body")).toHaveCSS("vector-effect", "non-scaling-stroke");
  await canvas.focus();
  await page.keyboard.press("Tab");
  await expect(source).toBeFocused();
  await expect(source).toHaveCSS("outline-style", "none");
  await expect(source.locator(".ls-block-body")).toHaveCSS("stroke-width", "2.5px");
  const worldPoint = (x, y) => canvas.evaluate((node, point) => {
    const screen = new DOMPoint(point.x, point.y).matrixTransform(node.getScreenCTM());
    return { x: screen.x, y: screen.y };
  }, { x, y });
  const centre = async (locator) => { const box = await locator.boundingBox(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
  const drag = async (from, to, button = "left") => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down({ button });
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up({ button });
  };
  const arrowSize = (zoom) => canvas.evaluate(async (node, scale) => {
    const marker = node.querySelector("marker").cloneNode(true);
    marker.querySelector("path").style.fill = "red";
    const style = getComputedStyle(node.querySelector(".ls-link-line"));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120"><defs>${marker.outerHTML}</defs>
      <g transform="scale(${scale})"><path d="M10 40H180" fill="none" stroke="black" stroke-width="${style.strokeWidth}"
        vector-effect="${style.vectorEffect}" marker-end="url(#${marker.id})"/></g></svg>`;
    const image = new Image();
    image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    await image.decode();
    const bitmap = document.createElement("canvas");
    bitmap.width = 400; bitmap.height = 120;
    const context = bitmap.getContext("2d");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, 400, 120).data;
    let left = 400, right = -1, top = 120, bottom = -1;
    for (let y = 0; y < 120; y++) for (let x = 0; x < 400; x++) {
      const i = (y * 400 + x) * 4;
      if (pixels[i] > 200 && pixels[i + 1] < 30 && pixels[i + 2] < 30 && pixels[i + 3] > 100) {
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    return { width: right - left + 1, height: bottom - top + 1 };
  }, zoom);

  await source.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: /Delete block/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(canvas).toBeFocused();

  const cursor = await worldPoint(400, 200);
  const before = await canvas.evaluate((node, point) => {
    const world = new DOMPoint(point.x, point.y).matrixTransform(node.getScreenCTM().inverse());
    return { x: world.x, y: world.y };
  }, cursor);
  await page.mouse.move(cursor.x, cursor.y);
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => Number(await canvas.getAttribute("data-zoom"))).toBeGreaterThan(1);
  const anchor = await worldPoint(before.x, before.y);
  assert(Math.abs(anchor.x - cursor.x) < 1 && Math.abs(anchor.y - cursor.y) < 1,
    `wheel zoom must stay anchored to the cursor: ${JSON.stringify({ cursor, anchor, before, view: await canvas.getAttribute("viewBox") })}`);

  const unchanged = await source.getAttribute("transform");
  const view = await canvas.getAttribute("viewBox");
  const from = await centre(source);
  await drag(from, { x: from.x + 90, y: from.y + 45 }, "right");
  assert.notEqual(await canvas.getAttribute("viewBox"), view);
  await expect(source).toHaveAttribute("transform", unchanged);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByText("Not saved", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Reset camera", exact: true }).click();
  for (let i = 0; i < 4; i++) {
    const previous = Number(await canvas.getAttribute("data-zoom"));
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    await expect.poll(async () => Number(await canvas.getAttribute("data-zoom"))).toBeLessThan(previous);
  }
  await page.getByRole("button", { name: "CNC lathe", exact: true }).click();
  const machine = canvas.locator(".ls-machine");
  const machineCentre = await centre(machine);
  const box = await canvas.boundingBox();
  assert(machineCentre.x >= box.x && machineCentre.x <= box.x + box.width && machineCentre.y >= box.y && machineCentre.y <= box.y + box.height, "palette clicks should add into the current view");
  await drag(await centre(source.locator("[data-port]")), await centre(machine));
  await drag(await centre(machine.locator("[data-port]")), await centre(sink));
  await expect(canvas.locator(".ls-link")).toHaveCount(2);
  const zoomLevels = [1, .5, .2];
  const normalArrows = [];
  for (const zoom of zoomLevels) normalArrows.push(await arrowSize(zoom));
  const selectedLink = canvas.locator(".ls-link").first();
  await selectedLink.focus();
  await expect(selectedLink).toHaveCSS("outline-style", "none");
  await expect(selectedLink.locator(".ls-link-line")).toHaveCSS("vector-effect", "non-scaling-stroke");
  await expect(selectedLink.locator(".ls-link-line")).toHaveCSS("stroke-width", "3px");
  for (let i = 0; i < zoomLevels.length; i++) {
    const highlighted = await arrowSize(zoomLevels[i]);
    assert(normalArrows[i].width > 0 && normalArrows[i].height > 0, "probe must render the actual arrowhead");
    assert(Math.abs(highlighted.width - normalArrows[i].width) <= 1 && Math.abs(highlighted.height - normalArrows[i].height) <= 1,
      `highlight must not enlarge an arrowhead at ${zoomLevels[i]} zoom: ${JSON.stringify({ normal: normalArrows[i], highlighted })}`);
    assert(highlighted.width <= normalArrows[0].width + 1, "zooming out must not enlarge the arrowhead");
  }
  const far = await worldPoint(1350, -220);
  await drag(await centre(source), far);
  await expect(source).toHaveAttribute("transform", "translate(1294 -252)");
  await page.getByRole("button", { name: "Fit line", exact: true }).click();

  await page.getByLabel("Line name").fill("Wide test line");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText('Saved "Wide test line".')).toBeVisible();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByLabel("Open a saved line").selectOption({ label: "Wide test line" });
  await expect(source).toHaveAttribute("transform", "translate(1294 -252)");
  const restored = await centre(source);
  const restoredBox = await canvas.boundingBox();
  assert(restored.x >= restoredBox.x && restored.x <= restoredBox.x + restoredBox.width, "a reopened wide line should fit the board");
  await page.getByTestId("line-run").click();
  await expect(page.getByTestId("line-results")).toBeVisible();
  await page.getByRole("button", { name: "Skip to end", exact: true }).click();
  await source.click({ button: "right" });
  await page.screenshot({ path: resolve(output, "context-menu-light.png"), fullPage: true });
  await page.getByRole("menuitem", { name: /Delete block/ }).click();
  await expect(source).toHaveCount(0);
  await expect(canvas.locator(".ls-link")).toHaveCount(1);

  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  const connection = canvas.locator(".ls-link");
  await connection.locator(".ls-link-line").click({ button: "right", force: true });
  await expect(page.getByRole("menuitem", { name: /Delete connection/ })).toBeVisible();
  await page.screenshot({ path: resolve(output, "context-menu-dark.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.getByRole("button", { name: "Fit line", exact: true }).click();
  await machine.focus();
  await page.keyboard.press("Shift+F10");
  const menuBox = await page.getByRole("menu").boundingBox();
  assert(menuBox.x >= 0 && menuBox.x + menuBox.width <= 390 && menuBox.y >= 0 && menuBox.y + menuBox.height <= 844);
  await page.screenshot({ path: resolve(output, "context-menu-mobile.png"), fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "canvas controls must not overflow mobile");
  assert.deepEqual(errors, []);
  console.log("Passed: context deletion, pan/menu distinction, cursor zoom, zoomed linking and dragging, wide-line Save/Open, simulation, light/dark and mobile menus.");
} finally {
  await browser.close();
}
