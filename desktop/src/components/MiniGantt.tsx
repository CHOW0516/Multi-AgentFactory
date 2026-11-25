// A small read-only Gantt: one row per lane (machine or order), bars placed by time.
import type { CSSProperties } from "react";
import { formatDate, formatDateTime } from "./format";

export interface GanttBar {
  id: string;
  lane: string;
  label: string;
  start: string;
  end: string;
  tone: "locked" | "tentative" | "done" | "highlight" | "maintenance" | "moved";
  onClick?: () => void;
}

interface MiniGanttProps {
  lanes: { key: string; label: string }[];
  bars: GanttBar[];
  from: string;
  to: string;
  showToday?: boolean;
  ariaLabel?: string;
}

export function MiniGantt({ lanes, bars, from, to, showToday = true, ariaLabel = "Schedule" }: MiniGanttProps) {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  const span = Math.max(end - start, 1);
  const percentOf = (time: number) => Math.min(100, Math.max(0, ((time - start) / span) * 100));
  const now = Date.now();
  const dayCount = Math.min(31, Math.round(span / 86_400_000));
  const dayTicks = Array.from({ length: dayCount + 1 }, (_unused, index) => start + index * 86_400_000);

  return (
    <div className="gantt" role="figure" aria-label={ariaLabel}>
      <div className="gantt-row gantt-axis">
        <div className="gantt-lane-label" />
        <div className="gantt-track">
          {dayTicks.map((tick, index) => (index % Math.ceil(dayCount / 8 || 1) === 0 ? (
            <span key={tick} className="gantt-tick" style={{ left: `${percentOf(tick)}%` }}>
              {formatDate(new Date(tick).toISOString()).slice(0, 6)}
            </span>
          ) : null))}
        </div>
      </div>
      {lanes.map((lane) => (
        <div className="gantt-row" key={lane.key}>
          <div className="gantt-lane-label">{lane.label}</div>
          <div className="gantt-track">
            {bars.filter((bar) => bar.lane === lane.key).map((bar) => {
              const left = percentOf(new Date(bar.start).getTime());
              const width = Math.max(percentOf(new Date(bar.end).getTime()) - left, 0.8);
              const style: CSSProperties = { left: `${left}%`, width: `${width}%` };
              const title = `${bar.label}: ${formatDateTime(bar.start)} – ${formatDateTime(bar.end)}`;
              return bar.onClick ? (
                <button type="button" key={bar.id} className={`gantt-bar gantt-${bar.tone}`} style={style}
                  title={title} aria-label={title} onClick={bar.onClick}>{bar.label}</button>
              ) : (
                <span key={bar.id} className={`gantt-bar gantt-${bar.tone}`} style={style} title={title}>{bar.label}</span>
              );
            })}
            {showToday && now > start && now < end ? (
              <span className="gantt-today" style={{ left: `${percentOf(now)}%` }} aria-label="Today" />
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
