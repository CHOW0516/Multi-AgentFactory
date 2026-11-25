import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DatePicker } from "../../src/components/DatePicker";

function Field({ onSubmit = () => undefined }: { onSubmit?: () => void }) {
  const [value, setValue] = useState("2028-02-28");
  return <form noValidate onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    <label htmlFor="delivery-date">Delivery date</label>
    <DatePicker id="delivery-date" value={value} min="2028-02-01" max="2028-03-05" onChange={setValue} />
    <button type="submit">Save</button>
  </form>;
}

describe("themed date picker", () => {
  it("navigates a leap day with the keyboard and returns focus to the field", () => {
    render(<Field />);
    const field = screen.getByLabelText("Delivery date");
    fireEvent.keyDown(field, { key: "ArrowDown" });
    const calendar = screen.getByRole("dialog", { name: "Choose date" });
    const selected = within(calendar).getByRole("button", { name: /\b28 February\b|\bFebruary 28\b/ });
    expect(selected).toHaveFocus();
    fireEvent.keyDown(selected, { key: "ArrowRight" });
    const leapDay = within(calendar).getByRole("button", { name: /\b29 February\b|\bFebruary 29\b/ });
    expect(leapDay).toHaveFocus();
    fireEvent.click(leapDay);
    expect(field).toHaveValue("2028-02-29");
    expect(field).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("disables dates outside the range and lets Escape close without changing the date", () => {
    render(<Field />);
    const field = screen.getByLabelText("Delivery date");
    fireEvent.keyDown(field, { key: "ArrowDown" });
    const calendar = screen.getByRole("dialog");
    const blocked = within(calendar).getByRole("button", { name: /\b31 January\b|\bJanuary 31\b/ });
    expect(blocked).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(blocked);
    expect(field).toHaveValue("2028-02-28");
    fireEvent.keyDown(calendar, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(field).toHaveFocus();
  });

  it("prevents impossible or out-of-range typed dates from submitting stale values", () => {
    const submit = vi.fn();
    render(<Field onSubmit={submit} />);
    const field = screen.getByLabelText("Delivery date");
    fireEvent.change(field, { target: { value: "2028-02-30" } });
    expect(field).toBeInvalid();
    fireEvent.submit(field.closest("form")!);
    expect(submit).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "2028-03-08" } });
    expect(field).toBeInvalid();
    fireEvent.change(field, { target: { value: "2028-03-02" } });
    fireEvent.submit(field.closest("form")!);
    expect(submit).toHaveBeenCalledOnce();
  });
});
