import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Profile a mock production build served with `vite preview --port 5174`.
// Use the same browser, viewport and gesture duration for before/after runs.
const output = resolve("../.impeccable/review");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 970 } });
const results = [];
try {
  await page.goto(process.env.P5_URL ?? "http://127.0.0.1:5174");
  await page.getByLabel("Email").fill("manager@factory.local");
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.getByRole("button", { name: /^CNC Lathe 1,/ }).waitFor();
  for (const section of ["Factory floor", "Agent map"]) {
    await page.getByRole("link", { name: section, exact: true }).click();
    await expect(page.getByRole("heading", { name: section, exact: true })).toBeVisible();
    for (const mode of ["orbit", "pan", "zoom"]) {
      await page.getByRole("button", { name: "Reset camera", exact: true }).click();
      await page.waitForTimeout(350);
      const box = await page.locator(".floor-model").boundingBox();
      const x = box.x + box.width * .25;
      const y = box.y + box.height * .6;
      await page.mouse.move(x, y);
      if (mode !== "zoom") await page.mouse.down({ button: mode === "pan" ? "right" : "left" });
      const result = await page.evaluate(async ({ mode, x, y }) => {
        const svg = document.querySelector(".floor-model");
        const times = [];
        let writes = 0;
        let parseMs = 0;
        let mutations = 0;
        const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
        Object.defineProperty(Element.prototype, "innerHTML", { ...descriptor, set(value) {
          const start = performance.now();
          descriptor.set.call(this, value);
          if (this instanceof SVGElement) { writes++; parseMs += performance.now() - start; }
        } });
        const observer = new MutationObserver((records) => { mutations += records.length; });
        observer.observe(svg, { attributes: true, childList: true, subtree: true });
        let began;
        let previous;
        await new Promise((done) => {
          function tick(now) {
            began ??= now;
            if (previous !== undefined) times.push(now - previous);
            previous = now;
            const t = Math.min(1, (now - began) / 2000);
            if (mode === "zoom") svg.dispatchEvent(new WheelEvent("wheel", { deltaY: -3, clientX: x, clientY: y, bubbles: true, cancelable: true }));
            else svg.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, buttons: mode === "pan" ? 2 : 1, clientX: x + t * 180, clientY: y + Math.sin(t * Math.PI) * 45, bubbles: true }));
            if (t < 1) requestAnimationFrame(tick);
            else done();
          }
          requestAnimationFrame(tick);
        });
        observer.disconnect();
        Object.defineProperty(Element.prototype, "innerHTML", descriptor);
        times.sort((a, b) => a - b);
        return { fps: Number((times.length * 1000 / times.reduce((a, b) => a + b, 0)).toFixed(1)),
          p95Ms: Number(times[Math.floor(times.length * .95)].toFixed(1)), svgWrites: writes,
          svgParseMs: Math.round(parseMs), mutations, elements: svg.querySelectorAll("*").length };
      }, { mode, x, y });
      if (mode !== "zoom") await page.mouse.up({ button: mode === "pan" ? "right" : "left" });
      await expect(page.locator(".floor-model")).toHaveAttribute("data-detail", "full");
      results.push({ section, mode, ...result });
      console.log(JSON.stringify(results.at(-1)));
    }
  }
  await writeFile(resolve(output, `camera-${process.env.CAMERA_BENCHMARK ?? "latest"}.json`), JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
