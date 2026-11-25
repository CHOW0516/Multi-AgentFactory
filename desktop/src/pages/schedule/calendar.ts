import type { MaintenanceWindowOut, ScheduleOut, ScheduleSlotOut } from "../../api/types";
import { addDays } from "../../components/format";

export const hour = 3_600_000;
export const hourHeight = 72;
export const defaultTimezone = "Asia/Kuala_Lumpur";

export const bookingLabels = {
  locked: "Locked", tentative: "Tentative", done: "Done", planned: "Maintenance", breakdown: "Breakdown",
};

export type Booking = {
  id: string; machineId: string; title: string; start: number; end: number;
} & ({ tone: ScheduleSlotOut["status"]; slot: ScheduleSlotOut } |
  { tone: MaintenanceWindowOut["maintenance_type"]; maintenance: MaintenanceWindowOut });

export type ScheduledBooking = {
  booking: Booking; start: number; end: number; column: number; columns: number;
};

export function dayInZone(time: number, formatter: Intl.DateTimeFormat) {
  const parts = formatter.formatToParts(time);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return [part("year").padStart(4, "0"), part("month"), part("day")].join("-");
}

export function calendarDayFormatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
}

function midnight(day: string, formatter: Intl.DateTimeFormat) {
  const nominal = Date.parse(`${day}T00:00:00Z`) / 1000;
  let lower = nominal - 36 * 3600;
  let upper = nominal + 36 * 3600;
  // Search by local date so an offset change at midnight cannot shift the day boundary.
  while (upper - lower > 1) {
    const middle = Math.floor((lower + upper) / 2);
    if (dayInZone(middle * 1000, formatter) < day) lower = middle;
    else upper = middle;
  }
  return upper * 1000;
}

export function dayRange(day: string, formatter: Intl.DateTimeFormat) {
  return { start: midnight(day, formatter), end: midnight(addDays(day, 1), formatter) };
}

export function collectBookings(schedule: ScheduleOut): Booking[] {
  return [
    ...schedule.slots.map((slot): Booking => ({
      id: slot.id, machineId: slot.machine_id, title: slot.order_number, tone: slot.status,
      start: Date.parse(slot.start_at), end: Date.parse(slot.end_at), slot,
    })),
    ...schedule.maintenance.map((maintenance, index): Booking => ({
      id: `maintenance-${index}`, machineId: maintenance.machine_id, title: bookingLabels[maintenance.maintenance_type],
      tone: maintenance.maintenance_type, start: Date.parse(maintenance.start_at),
      end: maintenance.end_at ? Date.parse(maintenance.end_at) : Infinity, maintenance,
    })),
  ];
}

export function placeBookings(bookings: Booking[], dayStart: number, dayEnd: number) {
  const byMachine = new Map<string, ScheduledBooking[]>();
  for (const booking of bookings) {
    const start = Math.max(dayStart, booking.start);
    const end = Math.min(dayEnd, booking.end);
    if (!(end > start)) continue;
    const lane = byMachine.get(booking.machineId) ?? [];
    lane.push({ booking, start, end, column: 0, columns: 1 });
    byMachine.set(booking.machineId, lane);
  }

  for (const lane of byMachine.values()) {
    lane.sort((first, second) => first.start - second.start || second.end - first.end);
    let overlapEnd = -Infinity;
    let groupStart = 0;
    let columnEnds: number[] = [];
    for (const [index, block] of lane.entries()) {
      if (block.start >= overlapEnd) {
        for (const previous of lane.slice(groupStart, index)) previous.columns = columnEnds.length;
        groupStart = index;
        columnEnds = [];
      }
      const firstFree = columnEnds.findIndex((end) => end <= block.start);
      block.column = firstFree < 0 ? columnEnds.length : firstFree;
      columnEnds[block.column] = block.end;
      overlapEnd = Math.max(overlapEnd, block.end);
    }
    for (const block of lane.slice(groupStart)) block.columns = columnEnds.length;
  }
  return byMachine;
}
