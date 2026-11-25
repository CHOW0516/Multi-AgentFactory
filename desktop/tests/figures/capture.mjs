import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

// Build with VITE_USE_MOCKS=true. Optionally use a running mock dev server via P5_URL.
const output = resolve("dist/p5-qa");
await mkdir(output, { recursive: true });
const url = process.env.P5_URL ?? pathToFileURL(resolve("dist/index.html")).href;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ["--disable-webgl", "--allow-file-access-from-files"],
});
const errors = [];

async function login(page) {
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.getByLabel("Email").fill("manager@factory.local");
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByRole("button", { name: /^CNC Lathe 1,/ }).waitFor();
}

const shot = (page, name) => page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true, scale: "css", timeout: 30_000 });
const closeups = async (page, selector, tag) => {
  const figures = await page.locator(selector).all();
  for (const [index, figure] of figures.entries()) {
    const viewport = await figure.boundingBox();
    assert(viewport && viewport.width > 0 && viewport.height > 0);
    await figure.screenshot({ path: resolve(output, `${tag}-${index + 1}.png`) });
  }
};

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 970 }, deviceScaleFactor: 4 });
  const page = await desktop.newPage();
  page.setDefaultTimeout(12_000);
  await login(page);
  await shot(page, "floor-light");
  await closeups(page, "[data-machine]", "floor-light-machine");
  const lathe = page.getByRole("button", { name: /^CNC Lathe 1,/ });
  await lathe.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: "CNC Lathe 1" });
  await drawer.getByText("Utilisation today").waitFor();
  await drawer.getByRole("button", { name: "Set status" }).click();
  await drawer.getByRole("combobox").selectOption("maintenance");
  await drawer.getByRole("button", { name: "Save" }).click();
  await drawer.getByText("Machine updated.").waitFor();
  await shot(page, "floor-details");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^CNC Lathe 1, Maintenance/ }).waitFor();
  const maintenance = page.locator('[data-status="maintenance"] .p5-beacon-on').first();
  assert.match(await maintenance.evaluate((node) => getComputedStyle(node).fill), /rgb\(55, 120, 214\)/);
  await lathe.focus();
  await page.keyboard.press("Enter");
  await drawer.getByRole("button", { name: "Log breakdown" }).click();
  await drawer.getByLabel("Breakdown note").fill("Spindle vibration");
  await drawer.getByLabel("Estimated downtime (hours)").fill("2");
  await drawer.getByRole("button", { name: "Save" }).click();
  await drawer.getByText("Spindle vibration", { exact: false }).waitFor();
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "Agent map" }).click();
  const plan = page.getByRole("button", { name: "Planning station" });
  await plan.waitFor();
  await page.locator("[data-parcel]").first().waitFor({ timeout: 10_000 });
  await shot(page, "agents-light");
  await closeups(page, "[data-station]", "agents-light-station");
  await plan.focus();
  await page.keyboard.press("Enter");
  const agent = page.getByRole("dialog", { name: "Planning" });
  await agent.getByText("Last 50 messages").waitFor();
  await agent.locator("details summary").first().click();
  assert(await agent.locator("details[open] pre").first().textContent());
  await page.keyboard.press("Escape");
  const rail = page.getByRole("button", { name: "Planning rail" });
  await rail.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "Planning rail" }).getByText("Recent messages on this link").waitFor();
  await page.keyboard.press("Escape");

  const orderReplay = page.getByRole("combobox", { name: "Order replay" });
  await orderReplay.selectOption({ label: "SO-2026-0412" });
  await page.getByLabel("Speed").selectOption("4");
  const scrubber = page.getByLabel("Replay time");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(() => Number(document.querySelector('input[type="range"]')?.value) > 200);
  await page.getByRole("button", { name: "Pause" }).click();
  const paused = await scrubber.inputValue();
  await page.waitForTimeout(170);
  assert.equal(await scrubber.inputValue(), paused);
  await scrubber.focus();
  await page.keyboard.press("End");
  assert.equal(await scrubber.inputValue(), await scrubber.getAttribute("max"));
  await orderReplay.selectOption("");

  const theme = page.getByRole("button", { name: /theme/i });
  await theme.click();
  await page.locator('.p5-page[data-theme="dark"]').waitFor();
  await shot(page, "agents-dark");
  await closeups(page, "[data-station]", "agents-dark-station");
  await page.getByRole("link", { name: "Factory floor" }).click();
  await page.getByRole("button", { name: /^CNC Lathe 1,/ }).waitFor();
  await shot(page, "floor-dark");
  await closeups(page, "[data-machine]", "floor-dark-machine");
  await desktop.close();

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  phone.setDefaultTimeout(12_000);
  await login(phone);
  assert.equal(await phone.locator(".p5-scene").getAttribute("data-animate"), null);
  await phone.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth);
  await shot(phone, "floor-phone");
  await phone.getByRole("link", { name: "Agent map" }).click();
  await phone.getByRole("button", { name: "Order station" }).waitFor();
  await phone.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth);
  await shot(phone, "agents-phone");
  await phone.close();

  const timingPage = await browser.newPage({ viewport: { width: 1440, height: 970 } });
  timingPage.setDefaultTimeout(12_000);
  await login(timingPage);
  await timingPage.getByRole("link", { name: "Agent map" }).click();
  await timingPage.locator("[data-parcel]").first().waitFor({ timeout: 10_000 });
  const timing = await timingPage.evaluate(() => new Promise((done) => {
    const intervals = [];
    const start = performance.now();
    let last;
    function measure(now) {
      if (last !== undefined) intervals.push(now - last);
      last = now;
      if (now - start < 3500) requestAnimationFrame(measure);
      else {
        const elapsed = intervals.reduce((sum, value) => sum + value, 0);
        const sorted = intervals.toSorted((left, right) => left - right);
        done({ fps: Math.round(intervals.length * 1000 / elapsed), p95Ms: sorted[Math.floor(sorted.length * .95)] });
      }
    }
    requestAnimationFrame(measure);
  }));
  console.log("Agent map frame timing", timing);
  assert.deepEqual(errors, []);
  console.log(`P5 browser checks passed. Captures in ${output}`);
} finally {
  await browser.close();
}
