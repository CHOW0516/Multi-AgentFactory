import { ApiError, registerMock } from "../../api/client";
import type { FieldCorrection } from "../../api/types";
import {
  customerMessages, fieldsByOrder, findOrder, planOptionsFor, timelineFor, users,
} from "../../components/mock-data";

function orderOr404(orderId: string) {
  const order = findOrder(orderId);
  if (!order) throw new ApiError(404, "Order not found");
  return order;
}

registerMock("GET", "/orders/:orderId", ({ params }) => orderOr404(params.orderId));
registerMock("GET", "/orders/:orderId/fields", ({ params }) => fieldsByOrder[orderOr404(params.orderId).id] ?? []);
registerMock("PATCH", "/orders/:orderId/fields", ({ params, body }) => {
  const fields = fieldsByOrder[params.orderId] ?? [];
  for (const correction of body as FieldCorrection[]) {
    const field = fields.find((candidate) => candidate.id === correction.field_id);
    if (field) Object.assign(field, { corrected_value: correction.corrected_value, corrected_by: users[3].id });
  }
  return fields;
});
registerMock("POST", "/orders/:orderId/fields/confirm", ({ params }) => {
  const order = orderOr404(params.orderId);
  order.status = "VERIFIED";
  for (const field of fieldsByOrder[order.id] ?? []) field.needs_check = false;
  return order;
});
registerMock("GET", "/orders/:orderId/timeline", ({ params }) => timelineFor(orderOr404(params.orderId)));
registerMock("GET", "/orders/:orderId/plan-options", ({ params }) => {
  const order = orderOr404(params.orderId);
  const planned = ["PLANNED", "WAITING_APPROVAL", "RECHECKING", "CONFIRMED", "REPLY_DRAFTED", "CUSTOMER_REPLIED", "IN_PRODUCTION", "COMPLETED", "REPLAN_NEEDED"];
  if (!planned.includes(order.status)) throw new ApiError(404, "No plan yet");
  return planOptionsFor(order);
});
registerMock("GET", "/orders/:orderId/customer-message", ({ params }) => {
  const order = orderOr404(params.orderId);
  if (!customerMessages[order.id] && ["REPLY_DRAFTED", "CUSTOMER_REPLIED", "IN_PRODUCTION", "COMPLETED"].includes(order.status)) {
    customerMessages[order.id] = {
      id: `cm000000${order.id.slice(8)}`, order_id: order.id, plan_option_id: null, subject: `Re: Purchase order ${order.po_number}`,
      draft_text: `Dear ${order.customer_name},\n\nWe confirm PO ${order.po_number} for delivery on ${order.due_date}.\n\nBest regards,\nMei, Sales`,
      status: order.status === "REPLY_DRAFTED" ? "draft" : "sent_by_sales", sent_at: order.status === "REPLY_DRAFTED" ? null : order.created_at,
    };
  }
  const message = customerMessages[order.id];
  if (!message) throw new ApiError(404, "No customer message");
  return message;
});
registerMock("POST", "/orders/:orderId/customer-message/sent", ({ params }) => {
  const order = orderOr404(params.orderId);
  const message = customerMessages[order.id];
  if (message) Object.assign(message, { status: "sent_by_sales", sent_at: new Date().toISOString() });
  order.status = "CUSTOMER_REPLIED";
  return message;
});
