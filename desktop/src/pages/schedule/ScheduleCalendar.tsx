import { useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import type { MachineOut } from "../../api/types";
import { Icon } from "../../shell/icons";
import { bookingLabels, hour, hourHeight, placeBookings, type Booking, type ScheduledBooking } from "./calendar";

function BookingCard({ block, start, time, machine, onSelect }: {
  block: ScheduledBooking; start: number; time: Intl.DateTimeFormat; machine: MachineOut; onSelect: () => void;
}) {
  const { booking } = block;
  const label = bookingLabels[booking.tone];
  const from = block.start === booking.start ? time.format(block.start) : "↳ " + time.format(block.start);
  const to = Number.isFinite(booking.end) ?
    (block.end === booking.end ? time.format(block.end) : "24:00 →") : "Ongoing";
  const height = (block.end - block.start) / hour * hourHeight;
  const compact = height < 56 || block.columns > 1;

  return <button type="button" className="schedule-booking" data-tone={booking.tone} data-compact={compact || undefined}
    data-short={height < 32 || undefined}
    aria-label={`${booking.title}, ${label}, ${machine.code}, ${from} to ${to}`}
    data-tooltip={`${booking.title} · ${label} · ${from} – ${to}`} onClick={onSelect}
    style={{
      top: (block.start - start) / hour * hourHeight,
      height,
      left: `${block.column / block.columns * 100}%`,
      width: `${100 / block.columns}%`,
    }}>
    <span className="schedule-booking-card">
      <span className="schedule-booking-info">
        <span className="schedule-booking-time">{from} – {to}</span>
        <strong>{booking.title}</strong>
        {!compact && "slot" in booking && <span className="schedule-booking-meta">
          {label} · {Number(booking.slot.quantity).toLocaleString()} pcs{booking.slot.is_overtime ? " · OT" : ""}
        </span>}
      </span>
    </span>
  </button>;
}

export function ScheduleCalendar({ machines, bookings, start, end, now, timeZone, jump, onSelect }: {
  machines: MachineOut[]; bookings: Booking[]; start: number; end: number; now: number; timeZone: string;
  jump: number; onSelect: (booking: Booking, machine: MachineOut) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLDivElement>(null);
  const time = useMemo(() => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), [timeZone]);
  const timeWithOffset = useMemo(() => new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "shortOffset",
  }), [timeZone]);
  const placements = useMemo(() => placeBookings(bookings, start, end), [bookings, start, end]);
  const height = (end - start) / hour * hourHeight;
  const isToday = now >= start && now < end;
  const nowPosition = (now - start) / hour * hourHeight;
  const ticks = Array.from({ length: Math.ceil((end - start) / hour) }, (_, index) => start + index * hour);
  const tickLabels = ticks.map((tick) => time.format(tick));

  useLayoutEffect(() => {
    const viewport = scroll.current;
    if (!viewport) return;
    const first = machines.reduce((earliest, machine) =>
      Math.min(earliest, placements.get(machine.id)?.[0]?.start ?? Infinity), Infinity);
    const initial = isToday ? nowPosition - (viewport.clientHeight - (header.current?.offsetHeight ?? 0)) * .42 :
      Number.isFinite(first) ? (first - start) / hour * hourHeight - hourHeight : 7 * hourHeight;
    viewport.scrollTop = Math.max(0, initial);
    // The calendar remounts on date changes. Only Today repositions an already-open date.
  }, [jump]);

  return <div ref={scroll} className="schedule-calendar" role="region" tabIndex={0} aria-label="Machine schedule. Scroll for more hours and machines.">
    <div className="schedule-grid" style={{ "--machine-count": machines.length, "--schedule-height": `${height}px`,
      "--hour-height": `${hourHeight}px` } as CSSProperties}>
      <div className="schedule-grid-heading" ref={header}>
        <div className="schedule-time-heading"><Icon name="clock" size={15} /><span>Time</span></div>
        {machines.map((machine) => <div className="schedule-machine" key={machine.id}>
          <span className="schedule-machine-icon"><Icon name="factory" size={16} /></span>
          <span><strong>{machine.code}</strong><small>{machine.name}</small></span>
        </div>)}
      </div>
      <div className="schedule-grid-body">
        <div className="schedule-hours">
          {ticks.map((tick, index) => <span key={tick} className="schedule-hour" style={{ top: index * hourHeight }}>
            {tickLabels.indexOf(tickLabels[index]) === tickLabels.lastIndexOf(tickLabels[index]) ? tickLabels[index] : timeWithOffset.format(tick)}
          </span>)}
          {isToday && <time className="schedule-now-label" style={{ top: nowPosition }}
            dateTime={new Date(now).toISOString()} aria-label={`Current time ${time.format(now)}`}>{time.format(now)}</time>}
        </div>
        {machines.map((machine) => <div key={machine.id} className="schedule-lane" aria-label={machine.name}>
          {placements.get(machine.id)?.map((block) =>
            <BookingCard key={block.booking.id} block={block} start={start} time={time} machine={machine}
              onSelect={() => onSelect(block.booking, machine)} />)}
        </div>)}
        {isToday && <div className="schedule-now-line" style={{ top: nowPosition }} aria-hidden="true" />}
      </div>
    </div>
  </div>;
}
