import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { TimePicker } from "../../src/components/TimePicker";

function Field({ onSubmit = () => undefined }: { onSubmit?: () => void }) {
  const [value, setValue] = useState("08:00");
  return <form noValidate onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    <label htmlFor="shift-start">Start</label>
    <TimePicker id="shift-start" value={value} min="06:00" max="22:30" required onChange={setValue} />
    <button type="submit">Save shift</button>
  </form>;
}

describe("themed time picker", () => {
  it("stages an exact hour and minute using the keyboard and commits with Set time", () => {
    render(<Field />);
    const field = screen.getByLabelText("Start");
    fireEvent.keyDown(field, { key: "ArrowDown" });
    const popup = screen.getByRole("dialog", { name: "Choose time" });
    const hours = within(popup).getByRole("listbox", { name: "Hour" });
    const minutes = within(popup).getByRole("listbox", { name: "Minute" });
    const eight = within(hours).getByRole("option", { name: "08" });
    expect(eight).toHaveFocus();
    fireEvent.keyDown(eight, { key: "ArrowDown" });
    expect(within(hours).getByRole("option", { name: "09" })).toHaveFocus();
    fireEvent.keyDown(within(hours).getByRole("option", { name: "09" }), { key: "ArrowRight" });
    fireEvent.keyDown(within(minutes).getByRole("option", { name: "00" }), { key: "End" });
    expect(within(minutes).getByRole("option", { name: "59" })).toHaveFocus();
    expect(field).toHaveValue("08:00");
    fireEvent.click(within(popup).getByRole("button", { name: "Set time" }));
    expect(field).toHaveValue("09:59");
    expect(field).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores out-of-range options and cancels a pending choice with Escape", () => {
    render(<Field />);
    const field = screen.getByLabelText("Start");
    fireEvent.keyDown(field, { key: "ArrowDown" });
    const popup = screen.getByRole("dialog");
    const hours = within(popup).getByRole("listbox", { name: "Hour" });
    const blocked = within(hours).getByRole("option", { name: "23" });
    expect(blocked).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(blocked);
    expect(within(hours).getByRole("option", { name: "08" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(hours).getByRole("option", { name: "22" }));
    const minutes = within(popup).getByRole("listbox", { name: "Minute" });
    fireEvent.keyDown(within(minutes).getByRole("option", { name: "00" }), { key: "End" });
    expect(within(minutes).getByRole("option", { name: "30" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(popup, { key: "Escape" });
    expect(field).toHaveValue("08:00");
    expect(field).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("rejects invalid typed time without submitting the old value", () => {
    const submit = vi.fn();
    render(<Field onSubmit={submit} />);
    const field = screen.getByLabelText("Start");
    fireEvent.change(field, { target: { value: "25:89" } });
    expect(field).toBeInvalid();
    fireEvent.submit(field.closest("form")!);
    expect(submit).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "23:00" } });
    expect(field).toBeInvalid();
    fireEvent.change(field, { target: { value: "21:37" } });
    fireEvent.submit(field.closest("form")!);
    expect(field).toHaveValue("21:37");
    expect(submit).toHaveBeenCalledOnce();
  });

  it("dismisses when keyboard focus leaves the picker without stealing that focus", () => {
    render(<Field />);
    const field = screen.getByLabelText("Start");
    fireEvent.keyDown(field, { key: "ArrowDown" });
    const save = screen.getByRole("button", { name: "Save shift" });
    act(() => save.focus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(save).toHaveFocus();
    expect(field).toHaveValue("08:00");
  });
});
