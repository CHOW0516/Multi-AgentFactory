import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Select } from "../../src/components/Select";

function Field({ changed = () => undefined }: { changed?: (value: string) => void }) {
  const [value, setValue] = useState("mon");
  return <form><label htmlFor="day">Day</label><Select id="day" name="weekday" value={value}
    onChange={(event) => { setValue(event.target.value); changed(event.target.value); }}>
    <option value="mon">Monday</option><option value="tue" disabled>Tuesday</option>
    <option value="wed">Wednesday</option><option value="thu">Thursday</option>
  </Select></form>;
}

describe("themed select", () => {
  it("navigates options without committing until Enter and skips disabled options", () => {
    const changed = vi.fn();
    render(<Field changed={changed} />);
    const field = screen.getByRole("combobox", { name: "Day" });
    fireEvent.keyDown(field, { key: "ArrowDown" });
    const menu = screen.getByRole("listbox", { name: "Day" });
    expect(within(menu).getByRole("option", { name: "Monday" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(changed).not.toHaveBeenCalled();
    expect(field).toHaveValue("mon");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(field).toHaveValue("wed");
    expect(changed).toHaveBeenCalledWith("wed");
    expect(new FormData(field.closest("form")!).get("weekday")).toBe("wed");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("supports type-ahead and Escape without changing the selection", () => {
    render(<Field />);
    const field = screen.getByRole("combobox", { name: "Day" });
    fireEvent.keyDown(field, { key: "w" });
    const menu = screen.getByRole("listbox");
    const active = within(menu).getByRole("option", { name: "Wednesday" });
    expect(field).toHaveAttribute("aria-activedescendant", active.id);
    fireEvent.keyDown(field, { key: "Escape" });
    expect(field).toHaveValue("mon");
    expect(field).toHaveFocus();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("chooses from the themed menu by pointer and retains native form validation", () => {
    render(<Field />);
    const field = screen.getByRole("combobox", { name: "Day" });
    fireEvent.click(field);
    const menu = screen.getByRole("listbox");
    fireEvent.click(within(menu).getByRole("option", { name: "Tuesday" }));
    expect(field).toHaveValue("mon");
    fireEvent.click(within(menu).getByRole("option", { name: "Thursday" }));
    expect(field).toHaveValue("thu");
    expect(field).toHaveFocus();
  });
});
