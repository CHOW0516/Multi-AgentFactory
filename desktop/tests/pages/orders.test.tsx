import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fieldsByOrder, orders } from "../../src/components/mock-data";
import { FieldCheck } from "../../src/pages/order-detail/FieldCheck";
import { buildOrdersQuery } from "../../src/pages/orders/OrdersPage";

const flaggedOrder = orders.find((order) => order.status === "NEEDS_FIELD_CHECK");
const fields = fieldsByOrder[flaggedOrder?.id ?? ""];

describe("field check", () => {
  it("lets you edit only the flagged fields", () => {
    render(<FieldCheck fields={fields} editable onConfirm={() => {}} />);
    const flaggedCount = fields.filter((field) => field.needs_check).length;
    expect(flaggedCount).toBe(2);
    expect(screen.getAllByRole("textbox")).toHaveLength(flaggedCount);
    expect(screen.getByRole("textbox", { name: "Revision" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Quantity" })).not.toBeInTheDocument();
  });

  it("sends only the fields that were changed", async () => {
    const onConfirm = vi.fn();
    render(<FieldCheck fields={fields} editable onConfirm={onConfirm} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Due date" }), { target: { value: "2026-05-12" } });
    await userEvent.click(screen.getByTestId("field-check-confirm"));
    const dueField = fields.find((field) => field.field_name === "due_date");
    expect(onConfirm).toHaveBeenCalledWith([{ field_id: dueField?.id, corrected_value: "2026-05-12" }]);
  });

  it("is read-only outside field-check mode", () => {
    render(<FieldCheck fields={fields} editable={false} />);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryByTestId("field-check-confirm")).not.toBeInTheDocument();
  });
});

describe("order filters", () => {
  it("turns filters into the list query", () => {
    expect(buildOrdersQuery({ status: "", customerId: "", dueBefore: "", lateRiskOnly: false, search: "" })).toBe("/orders?page_size=200");
    expect(buildOrdersQuery({ status: "WAITING_APPROVAL", customerId: "c1", dueBefore: "2026-12-31", lateRiskOnly: true, search: "x" }))
      .toBe("/orders?page_size=200&status=WAITING_APPROVAL&customer_id=c1&due_to=2026-12-31&late_risk=true");
  });
});
