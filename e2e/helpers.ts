import { execSync } from "node:child_process";
import path from "node:path";
import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";

// ---- settings (override with environment variables) ----
export const API_BASE_URL = process.env.E2E_API_BASE_URL ?? "http://localhost:8000";
const REPOSITORY_ROOT = path.resolve(__dirname, "..");
const MANAGER_EMAIL = process.env.E2E_MANAGER_EMAIL ?? "manager@factory.local";
const SALES_EMAIL = process.env.E2E_SALES_EMAIL ?? "sales@factory.local";
const SEED_PASSWORD = process.env.E2E_PASSWORD ?? process.env.ADMIN_INITIAL_PASSWORD ?? "";
// How to make the simulator send one demo PO email. The Order agent picks it up from IMAP.
const SEND_PO_COMMAND =
  process.env.E2E_SEND_PO_COMMAND ?? "docker compose run --rm -T simulator python -m app.simulator send-po";

export type OrderSummary = { id: string; order_number: string; po_number: string | null; status: string };
export type ApprovalSummary = {
  id: string;
  order_id: string;
  approval_type: "order" | "replan";
  status: "waiting" | "decided" | "cancelled";
};
type Page_<Item> = { items: Item[]; total: number };

// ---- API helpers (contract endpoints) ----
export async function apiToken(email: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: SEED_PASSWORD }),
  });
  if (!response.ok) throw new Error(`Login failed for ${email}: ${response.status}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

export async function api<Result>(token: string, method: string, apiPath: string, body?: unknown): Promise<Result> {
  const response = await fetch(`${API_BASE_URL}/api${apiPath}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${apiPath} -> ${response.status}: ${await response.text()}`);
  return (await response.json()) as Result;
}

/** Polls `read` until `isDone` is true. Fails with the last value after the timeout. */
export async function waitFor<Value>(
  description: string,
  read: () => Promise<Value>,
  isDone: (value: Value) => boolean,
  timeoutMs = 5 * 60 * 1000,
): Promise<Value> {
  const deadline = Date.now() + timeoutMs;
  let lastValue: Value | undefined;
  while (Date.now() < deadline) {
    lastValue = await read();
    if (isDone(lastValue)) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Timed out waiting for ${description}. Last value: ${JSON.stringify(lastValue)}`);
}

export function managerToken(): Promise<string> {
  return apiToken(MANAGER_EMAIL);
}

export function salesToken(): Promise<string> {
  return apiToken(SALES_EMAIL);
}

// ---- demo PO ----
/** Sends one demo PO email and waits until its order exists. Returns the order. */
export async function sendDemoPurchaseOrder(token: string): Promise<OrderSummary> {
  const output = execSync(SEND_PO_COMMAND, { cwd: REPOSITORY_ROOT, encoding: "utf8" });
  const poNumber = output.trim().split("\n").pop()?.trim() ?? "";
  if (!poNumber.includes("-PO-")) throw new Error(`send-po did not print a PO number: ${output}`);
  return waitFor(
    `order for ${poNumber}`,
    async () => (await api<Page_<OrderSummary>>(token, "GET", "/orders?page_size=200")).items,
    (orders) => orders.some((order) => order.po_number === poNumber),
  ).then((orders) => orders.find((order) => order.po_number === poNumber) as OrderSummary);
}

export async function orderStatus(token: string, orderId: string): Promise<string> {
  return (await api<OrderSummary>(token, "GET", `/orders/${orderId}`)).status;
}

/** Waits until the order reaches one of `statuses`. */
export function waitForOrderStatus(token: string, orderId: string, statuses: string[]): Promise<string> {
  return waitFor(`order ${orderId} in ${statuses.join("/")}`, () => orderStatus(token, orderId), (status) =>
    statuses.includes(status),
  );
}

export async function waitingApproval(
  token: string,
  orderId: string,
  approvalType: "order" | "replan",
): Promise<ApprovalSummary> {
  const approvals = await waitFor(
    `${approvalType} approval for order ${orderId}`,
    async () => (await api<Page_<ApprovalSummary>>(token, "GET", "/approvals?status=waiting")).items,
    (items) => items.some((item) => item.order_id === orderId && item.approval_type === approvalType),
  );
  return approvals.find((item) => item.order_id === orderId && item.approval_type === approvalType) as ApprovalSummary;
}

/** Brings a new demo order to WAITING_APPROVAL, confirming the field check through the UI if it is flagged. */
export async function bringOrderToApproval(page: Page, token: string, order: OrderSummary): Promise<void> {
  const status = await waitForOrderStatus(token, order.id, ["NEEDS_FIELD_CHECK", "WAITING_APPROVAL"]);
  if (status === "NEEDS_FIELD_CHECK") {
    await openRoute(page, `/orders/${order.id}`);
    await page.getByTestId("field-check-confirm").click();
    await waitForOrderStatus(token, order.id, ["WAITING_APPROVAL"]);
  }
}

// ---- desktop app ----
export async function launchDesktop(): Promise<{ app: ElectronApplication; page: Page }> {
  const mainFile = path.join(REPOSITORY_ROOT, "desktop", "dist-electron", "main.cjs");
  // Chromium refuses to start as root (CI containers) unless its OS sandbox is off.
  const runningAsRoot = process.getuid?.() === 0;
  const app = await electron.launch({
    args: runningAsRoot ? ["--no-sandbox", mainFile] : [mainFile],
    env: { ...process.env, NODE_ENV: "production" },
  });
  const page = await app.firstWindow();
  return { app, page };
}

export async function logIn(page: Page, email: string): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await expect(page.getByLabel("Email")).toHaveCount(0);
}

export async function logInAsManager(page: Page): Promise<void> {
  await logIn(page, MANAGER_EMAIL);
}

/** Goes to a page by its route path (the app uses a hash router). */
export async function openRoute(page: Page, routePath: string): Promise<void> {
  await page.evaluate((target) => {
    window.location.hash = `#${target}`;
  }, routePath);
}
