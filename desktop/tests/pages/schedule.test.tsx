import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../src/api/client";
import type { MachineOut, ScheduleOut } from "../../src/api/types";
import { calendarDayFormatter, collectBookings, dayRange, placeBookings } from "../../src/pages/schedule/calendar";
import { ScheduleCalendar } from "../../src/pages/schedule/ScheduleCalendar";
import { SchedulePage } from "../../src/pages/schedule/SchedulePage";
import { renderPage } from "./helpers";

vi.mock("../../src/api/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/api/client")>(),
  apiFetch: vi.fn(),
}));

const machine: MachineOut = { id: "mill", code: "MILL-01", name: "CNC Mill 1", machine_type: "cnc_mill",
  status: "running", floor_x: 0, floor_y: 0 };
const schedule: ScheduleOut = {
  slots: [{
    id: "slot", machine_id: machine.id, order_id: "order", order_number: "SO-001", quantity: "40", routing_step: 2,
    start_at: "2026-11-25T01:00:00Z", end_at: "2026-11-25T05:00:00Z", status: "locked", is_overtime: false,
  }],
  maintenance: [{ machine_id: machine.id, start_at: "2026-11-25T03:00:00Z", end_at: null, maintenance_type: "breakdown" }],
};
const start = Date.parse("2026-11-24T16:00:00Z"), end = Date.parse("2026-11-25T16:00:00Z");
const morning = Date.parse("2026-11-25T03:20:00Z");

afterEach(() => vi.restoreAllMocks());

describe("schedule day layout", () => {
  it("uses the factory's calendar day and keeps a repeated daylight-saving hour", () => {
    expect(dayRange("2026-11-25", calendarDayFormatter("Asia/Kuala_Lumpur"))).toEqual({ start, end });
    const clocksChange = dayRange("2026-11-01", calendarDayFormatter("America/New_York"));
    expect(clocksChange.end - clocksChange.start).toBe(25 * 3_600_000);
  });

  it("places simultaneous bookings side by side and clips open downtime at the day boundary", () => {
    const [booking, maintenance] = placeBookings(collectBookings(schedule), start, end).get(machine.id)!;
    expect([booking.column, maintenance.column]).toEqual([0, 1]);
    expect([booking.columns, maintenance.columns]).toEqual([2, 2]);
    expect(maintenance.end).toBe(end);
  });

  it("moves the time line with the clock and hides it outside the selected day", () => {
    const props = { machines: [machine], bookings: collectBookings(schedule), start, end,
      timeZone: "Asia/Kuala_Lumpur", jump: 0, onSelect: vi.fn() };
    const { container, rerender } = render(<ScheduleCalendar {...props} now={morning} />);
    const line = container.querySelector<HTMLElement>(".schedule-now-line")!;
    const before = parseFloat(line.style.top);
    rerender(<ScheduleCalendar {...props} now={morning + 60_000} />);
    expect(parseFloat(line.style.top)).toBeGreaterThan(before);
    rerender(<ScheduleCalendar {...props} now={end} />);
    expect(line).not.toBeInTheDocument();
  });

  it("loads the selected date and opens the booking details with a link to the order", async () => {
    vi.spyOn(Date, "now").mockReturnValue(morning);
    const request = vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path === "/settings") return { timezone: "Asia/Kuala_Lumpur" };
      if (path === "/machines") return [machine];
      return schedule;
    });
    renderPage(<SchedulePage />);
    fireEvent.click(await screen.findByRole("button", { name: /SO-001/ }));
    const details = screen.getByRole("dialog", { name: "SO-001" });
    expect(within(details).getByText("40 pieces")).toBeVisible();
    expect(within(details).getByRole("link", { name: "Open order" })).toHaveAttribute("href", "/orders/order");
    fireEvent.click(within(details).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    expect(screen.getByLabelText("Date")).toHaveValue("2026-11-26");
    expect(request.mock.calls.some(([url]) => url.startsWith("/schedule?") &&
      new URLSearchParams(url.split("?")[1]).get("from") === "2026-11-25T16:00:00.000Z")).toBe(true);
    expect(screen.queryByLabelText(/Current time/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(await screen.findByLabelText("Current time 11:20")).toBeInTheDocument();
  });
});
