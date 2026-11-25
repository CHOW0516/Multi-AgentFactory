import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipLayer } from "../../src/components/TooltipLayer";

afterEach(() => { vi.useRealTimers(); });

describe("themed hover hints", () => {
  it("describes focused controls immediately and preserves existing descriptions", () => {
    const outerEscape = vi.fn();
    render(<div onKeyDown={outerEscape}>
      <p id="existing-note">Existing help</p>
      <button className="icon-button" aria-label="Reset camera" aria-describedby="existing-note">Reset</button>
      <TooltipLayer />
    </div>);
    const button = screen.getByRole("button");
    fireEvent.focusIn(button);
    const hint = screen.getByRole("tooltip");
    expect(hint).toHaveTextContent("Reset camera");
    expect(button.getAttribute("aria-describedby")?.split(" ")).toEqual(["existing-note", hint.id]);
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(button).toHaveAttribute("aria-describedby", "existing-note");
    expect(outerEscape).toHaveBeenCalledOnce();
    fireEvent.keyDown(button, { key: "Escape" });
    expect(outerEscape).toHaveBeenCalledTimes(2);
  });

  it("delays hover hints, supports nested SVG targets, and dismisses on scroll", () => {
    vi.useFakeTimers();
    render(<><svg><g data-tooltip="CNC Lathe 1 · Running"><path data-testid="machine-shape" /></g></svg><TooltipLayer /></>);
    fireEvent.pointerOver(screen.getByTestId("machine-shape"));
    act(() => { vi.advanceTimersByTime(399); });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole("tooltip")).toHaveTextContent("CNC Lathe 1 · Running");
    fireEvent.scroll(document);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("stays visible while the pointer moves onto the hint and cleans up on unmount", () => {
    vi.useFakeTimers();
    const view = render(<><button data-tooltip="Material shortage details">Warning</button><TooltipLayer /></>);
    const button = screen.getByRole("button");
    fireEvent.pointerOver(button);
    act(() => { vi.advanceTimersByTime(400); });
    const hint = screen.getByRole("tooltip");
    fireEvent.pointerOut(button, { relatedTarget: hint });
    fireEvent.pointerEnter(hint);
    act(() => { vi.advanceTimersByTime(200); });
    expect(hint).toBeInTheDocument();
    view.rerender(<button data-tooltip="Material shortage details">Warning</button>);
    expect(screen.getByRole("button")).not.toHaveAttribute("aria-describedby");
  });
});
