import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../../api/client";
import type { MachineOut, ScheduleOut, SettingsOut } from "../../api/types";
import { Drawer } from "../../components/Dialog";
import { addDays, formatNumber, nameLabel } from "../../components/format";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState, QueryState } from "../../components/QueryState";
import { Icon } from "../../shell/icons";
import { bookingLabels, calendarDayFormatter, collectBookings, dayInZone, dayRange, defaultTimezone, type Booking } from "./calendar";
import { ScheduleCalendar } from "./ScheduleCalendar";
import "./schedule.css";

function useClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const read = () => setNow(Date.now());
    const timer = window.setInterval(read, 5000);
    document.addEventListener("visibilitychange", read);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
    };
  }, []);
  return now;
}

function BookingDetails({ selection, timeZone, onClose }: {
  selection: { booking: Booking; machine: MachineOut } | null; timeZone: string; onClose: () => void;
}) {
  const dateTime = useMemo(() => new Intl.DateTimeFormat("en-GB", {
    timeZone, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }), [timeZone]);
  if (!selection) return null;
  const { booking, machine } = selection;

  return <Drawer open title={booking.title} onClose={onClose}>
    <span className="schedule-detail-status" data-tone={booking.tone}>{bookingLabels[booking.tone]}</span>
    <dl className="schedule-details">
      <div><dt>Machine</dt><dd>{machine.code} · {machine.name}</dd></div>
      <div><dt>Starts</dt><dd>{dateTime.format(booking.start)}</dd></div>
      <div><dt>Ends</dt><dd>{Number.isFinite(booking.end) ? dateTime.format(booking.end) : "Ongoing"}</dd></div>
      {"slot" in booking && <>
        <div><dt>Routing step</dt><dd>{booking.slot.routing_step}</dd></div>
        <div><dt>Quantity</dt><dd>{formatNumber(booking.slot.quantity)} pieces</dd></div>
        <div><dt>Overtime</dt><dd>{booking.slot.is_overtime ? "Yes" : "No"}</dd></div>
      </>}
      <div><dt>Time zone</dt><dd>{timeZone.replaceAll("_", " ")}</dd></div>
    </dl>
    {"slot" in booking && <Link className="button button-primary" to={`/orders/${booking.slot.order_id}`}>Open order <Icon name="chevron-right" size={15} /></Link>}
  </Drawer>;
}

export function SchedulePage() {
  const now = useClock();
  const settingsQuery = useQuery({
    queryKey: ["settings"], queryFn: ({ signal }) => apiFetch<SettingsOut>("/settings", { signal }),
  });
  const timeZone = settingsQuery.data?.timezone ?? defaultTimezone;
  const dateFormatter = useMemo(() => calendarDayFormatter(timeZone), [timeZone]);
  const today = dayInZone(now, dateFormatter);
  const [picked, setPicked] = useState<string | null>(null);
  const [jump, setJump] = useState(0);
  const [machineType, setMachineType] = useState("");
  const [selection, setSelection] = useState<{ booking: Booking; machine: MachineOut } | null>(null);
  const close = useCallback(() => setSelection(null), []);
  const date = picked ?? today;
  const { start, end } = useMemo(() => dayRange(date, dateFormatter), [date, dateFormatter]);
  const scheduleQuery = useQuery({
    queryKey: ["schedule", start, end], enabled: !settingsQuery.isPending && end > start,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ from: new Date(start).toISOString(), to: new Date(end).toISOString() });
      return apiFetch<ScheduleOut>(`/schedule?${params}`, { signal });
    },
    refetchInterval: date === today ? 30_000 : false,
  });
  const machinesQuery = useQuery({
    queryKey: ["machines"], queryFn: ({ signal }) => apiFetch<MachineOut[]>("/machines", { signal }),
  });
  const machineTypes = [...new Set((machinesQuery.data ?? []).map((machine) => machine.machine_type))].sort();
  const bookings = useMemo(() => scheduleQuery.data ? collectBookings(scheduleQuery.data) : [], [scheduleQuery.data]);

  function selectDay(day: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day))) return;
    setPicked(day);
    close();
  }

  return <section className="schedule-page">
    <PageHeader title="Schedule" subtitle="Machine bookings and downtime" />
    <div className="schedule-workspace">
      <div className="schedule-toolbar">
        <div className="schedule-day-controls" role="group" aria-label="Schedule date">
          <div className="schedule-arrows">
            <button type="button" className="icon-button" aria-label="Previous day" data-tooltip="Previous day" onClick={() => selectDay(addDays(date, -1))}>
              <Icon name="chevron-left" size={17} />
            </button>
            <button type="button" className="icon-button" aria-label="Next day" data-tooltip="Next day" onClick={() => selectDay(addDays(date, 1))}>
              <Icon name="chevron-right" size={17} />
            </button>
          </div>
          <div className="schedule-date">
            <DatePicker aria-label="Date" value={date} required onChange={selectDay} />
          </div>
          <button className="button" type="button" data-tooltip="Go to today and the current time" onClick={() => {
            setPicked(null);
            setJump((value) => value + 1);
            close();
          }}>Today</button>
        </div>
        <div className="schedule-toolbar-end">
          <span className="schedule-zone" data-tooltip={timeZone}><Icon name="clock" size={15} />{timeZone.replaceAll("_", " ").split("/").at(-1)}</span>
          <label className="schedule-filter"><span className="sr-only">Machine type</span>
            <Select value={machineType} onChange={(event) => { setMachineType(event.target.value); close(); }}>
              <option value="">All machine types</option>
              {machineTypes.map((type) => <option key={type} value={type}>{nameLabel(type)}</option>)}
            </Select>
          </label>
        </div>
      </div>
      <div className="schedule-legend" aria-label="Booking statuses">
        {Object.entries(bookingLabels).map(([tone, label]) => <span key={tone} data-tone={tone}><i />{label}</span>)}
      </div>
      {end <= start ? <EmptyState>This date has no local hours in the factory time zone.</EmptyState> : (
        <QueryState query={machinesQuery}>
          {(allMachines) => {
            const machines = allMachines.filter((machine) => !machineType || machine.machine_type === machineType);
            return machines.length ? <QueryState query={scheduleQuery}>
              {() => <ScheduleCalendar key={`${date}:${timeZone}`} machines={machines} bookings={bookings}
                start={start} end={end} now={now} timeZone={timeZone} jump={jump} onSelect={(booking, machine) => setSelection({ booking, machine })} />}
            </QueryState> : <EmptyState>No machines match this view.</EmptyState>;
          }}
        </QueryState>
      )}
    </div>
    <BookingDetails selection={selection} timeZone={timeZone} onClose={close} />
  </section>;
}
