import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { launchDesktop, logInAsManager, managerToken, openRoute, sendDemoPurchaseOrder } from "./helpers";

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  ({ app, page } = await launchDesktop());
  await logInAsManager(page);
});

test.afterAll(async () => {
  await app?.close();
});

test("agent map shows message tokens while a PO is processed, and an agent opens its drawer", async () => {
  await openRoute(page, "/agent-map");
  await expect(page.getByTestId("agent-node-orchestrator")).toBeVisible();

  await sendDemoPurchaseOrder(await managerToken());

  // A token travels along a line when the orchestrator sends a task to the Order agent.
  await expect(page.getByTestId("agent-token").first()).toBeVisible({ timeout: 2 * 60 * 1000 });

  await page.getByTestId("agent-node-order").click();
  const drawer = page.getByTestId("agent-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText(/order/i);
});
