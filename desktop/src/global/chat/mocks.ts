import { registerMock } from "../../api/client";
import { approvals, findOrder } from "../../components/mock-data";

registerMock("POST", "/chat", ({ body }) => {
  const { message, order_id: orderId } = body as { message: string; order_id: string | null };
  const order = orderId ? findOrder(orderId) : undefined;
  if (order) {
    return `[tool] get_order(${order.order_number})\n[tool] get_plan_options(${order.order_number})\n`
      + `${order.order_number} for ${order.customer_name} is ${order.status.toLowerCase().replaceAll("_", " ")}. `
      + "The recommended option waits 6 days for the stainless sheet, so no overtime is needed. "
      + "If the customer must have the original date, 6 hours of Saturday overtime on CNC-01 keeps it for about MYR 540.";
  }
  if (/attention|today/i.test(message)) {
    return `[tool] list_waiting_approvals()\n[tool] list_machine_status()\n${approvals.filter((approval) => approval.status === "waiting").length} approvals are waiting. `
      + "PRS-01 is down until tomorrow afternoon, which moved one order. SS316 sheet is below minimum stock.";
  }
  return "[tool] search_orders()\nI looked at the open orders. Ask about a specific order for details.";
});
