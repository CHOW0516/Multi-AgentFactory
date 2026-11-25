import { registerMock } from "../../api/client";
import type { OrderDetail } from "../../api/types";
import { asPage, fieldsByOrder, orders } from "../../components/mock-data";

registerMock("GET", "/orders", ({ query }) => {
  let items = [...orders].sort((first, second) => second.created_at.localeCompare(first.created_at));
  const status = query.get("status");
  const customerId = query.get("customer_id");
  const dueTo = query.get("due_to");
  if (status) items = items.filter((order) => order.status === status);
  if (customerId) items = items.filter((order) => order.customer_id === customerId);
  if (dueTo) items = items.filter((order) => (order.due_date ?? "") <= dueTo);
  if (query.get("late_risk") === "true") items = items.filter((order) => order.late_risk);
  return asPage(items, query);
});


registerMock("POST", "/orders/upload", () => {
  const template = orders[0];
  const order: OrderDetail = {
    ...template, id: `0f000000-0000-4000-8000-${String(orders.length + 1).padStart(12, "0")}`,
    order_number: `SO-2026-${String(400 + orders.length).padStart(4, "0")}`, status: "RECEIVED", created_at: new Date().toISOString(),
  };
  orders.push(order);
  fieldsByOrder[order.id] = fieldsByOrder[template.id];
  return order;
});
