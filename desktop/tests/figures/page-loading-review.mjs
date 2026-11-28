import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

// Production mock build on port 5174; verifies real chunks rather than mocked imports.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const scripts = [];
  const errors = [];
  page.on("request", (request) => { if (request.resourceType() === "script") scripts.push(request.url()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.P5_URL ?? "http://127.0.0.1:5174");
  await page.getByLabel("Email").fill("manager@factory.local");
  assert(scripts.some((url) => url.includes("/LoginPage-")));
  assert(!scripts.some((url) => /\/(FactoryFloor|DashboardsPage|OrdersPage)-/.test(url)));
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.getByRole("heading", { name: "Factory floor", exact: true }).waitFor();
  assert(!scripts.some((url) => /\/(DashboardsPage|OrdersPage)-/.test(url)));
  await page.route("**/assets/OrdersPage-*.js", (route) => route.abort(), { times: 1 });
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("The page could not be loaded");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();
  assert(errors.every((message) => /Failed to fetch dynamically imported module/.test(message)), errors.join("\n"));
  console.log("Passed: pages load on demand; a failed chunk has a themed error and Retry recovers.");
} finally {
  await browser.close();
}
