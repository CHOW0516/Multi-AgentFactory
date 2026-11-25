import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import {
  api,
  bringOrderToApproval,
  launchDesktop,
  logInAsManager,
  managerToken,
  openRoute,
  sendDemoPurchaseOrder,
  waitForOrderStatus,
  waitingApproval,
} from "./helpers";

let app: ElectronApplication;
let page: Page;
let token: string;

test.beforeAll(async () => {
  token = await managerToken();
  ({ app, page } = await launchDesktop());
  await logInAsManager(page);
});

test.afterAll(async () => {
  await app?.close();
});

test("demo PO goes from email to approved order with a customer reply draft", async () => {
  const order = await sendDemoPurchaseOrder(token);

  // The new order shows up on the Orders page.
  await openRoute(page, "/orders");
  await expect(page.getByText(order.order_number)).toBeVisible();

  await bringOrderToApproval(page, token, order);
  const approval = await waitingApproval(token, order.id, "order");

  // Approve in the approval inbox.
  await openRoute(page, "/approvals");
  await page.getByTestId(`approval-row-${approval.id}`).click();
  await expect(page.getByTestId("approval-pack")).toBeVisible();
  await page.getByTestId("approve-button").click();

  // After the re-check the plan is locked and a reply is drafted for sales.
  await waitForOrderStatus(token, order.id, ["REPLY_DRAFTED"]);
  await openRoute(page, `/orders/${order.id}`);
  await expect(page.getByTestId("order-status")).toHaveText(/reply[ _]drafted/i);
  await expect(page.getByTestId("customer-reply-draft")).not.toBeEmpty();
});

test("manager rejects with a counter offer and the reply draft changes", async () => {
  const order = await sendDemoPurchaseOrder(token);
  await bringOrderToApproval(page, token, order);
  const approval = await waitingApproval(token, order.id, "order");

  // The pack's draft answers the order as requested; a counter offer must replace it.
  const pack = await api<{ customer_message: { draft_text: string } | null }>(token, "GET", `/approvals/${approval.id}`);
  const draftBefore = pack.customer_message?.draft_text ?? "";

  await openRoute(page, "/approvals");
  await page.getByTestId(`approval-row-${approval.id}`).click();
  await page.getByTestId("reject-button").click();
  await page.getByTestId("reject-reason-counter_offer").check();
  await page.getByTestId("reject-comment").fill("Offer a later date at the quoted price.");
  await page.getByTestId("reject-submit").click();

  // Counter offer: holds are kept and a new reply with the later option is drafted.
  await waitForOrderStatus(token, order.id, ["REPLY_DRAFTED"]);
  const message = await api<{ draft_text: string }>(token, "GET", `/orders/${order.id}/customer-message`);
  expect(message.draft_text.length).toBeGreaterThan(0);
  expect(message.draft_text).not.toBe(draftBefore);

  await openRoute(page, `/orders/${order.id}`);
  await expect(page.getByTestId("customer-reply-draft")).toContainText(message.draft_text.slice(0, 40));
});
