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

type ScheduleSlot = { machine_id: string };

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

test("machine breakdown on a planned order brings a replan approval", async () => {
  // Make a confirmed order with locked slots.
  const order = await sendDemoPurchaseOrder(token);
  await bringOrderToApproval(page, token, order);
  const approval = await waitingApproval(token, order.id, "order");
  await api(token, "POST", `/approvals/${approval.id}/decision`, { decision: "approve" });
  await waitForOrderStatus(token, order.id, ["CONFIRMED", "REPLY_DRAFTED"]);

  // Break the first machine the order uses, for long enough to miss the plan.
  const pack = await api<{ gantt_slots: ScheduleSlot[] }>(token, "GET", `/approvals/${approval.id}`);
  const machineId = pack.gantt_slots[0]?.machine_id;
  expect(machineId, "the approved plan has at least one slot").toBeTruthy();
  await api(token, "POST", `/machines/${machineId}/breakdown`, { note: "E2E breakdown", expected_hours: 72 });

  // The orchestrator replans and asks the manager again.
  const replan = await waitingApproval(token, order.id, "replan");
  await openRoute(page, "/approvals");
  await expect(page.getByTestId(`approval-row-${replan.id}`)).toBeVisible();
  await page.getByTestId(`approval-row-${replan.id}`).click();
  await expect(page.getByTestId("approval-what-changed")).toContainText(/breakdown|down/i);

  // Put the machine back so later runs start clean.
  await api(token, "POST", `/machines/${machineId}/status`, { status: "idle" });
});
