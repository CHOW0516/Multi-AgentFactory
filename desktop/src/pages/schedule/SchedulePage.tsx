import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../../api/client";
import type { MachineOut, ScheduleOut } from "../../api/types";
import { addDays, todayIso } from "../../components/format";
import { MiniGantt, type GanttBar } from "../../components/MiniGantt";
import { PageHeader } from "../../components/PageHeader";
import { QueryState } from "../../components/QueryState";

export function SchedulePage() {
  const navigate = useNavigate();
  const [from, setFrom] = useState(addDays(todayIso(), -1));
  const [to, setTo] = useState(addDays(todayIso(), 13));
  const [machineType, setMachineType] = useState("");
  const scheduleQuery = useQuery({ queryKey: ["schedule", from, to], queryFn: () => apiFetch<ScheduleOut>(`/schedule?from=${from}&to=${to}`) });
  const machinesQuery = useQuery({ queryKey: ["machines"], queryFn: () => apiFetch<MachineOut[]>("/machines") });
  const machines = (machinesQuery.data ?? []).filter((machine) => !machineType || machine.machine_type === machineType);
  const machineTypes = [...new Set((machinesQuery.data ?? []).map((machine) => machine.machine_type))];
  const rangeIsValid = from < to;

  return (
    <div>
      <PageHeader title="Schedule" subtitle="Machine plan. Locked slots are approved; dashed ones wait for approval. Read-only." />
      <div className="filter-bar">
        <div className="field"><label htmlFor="schedule-from">From</label>
          <input id="schedule-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div>
        <div className="field"><label htmlFor="schedule-to">To</label>
          <input id="schedule-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></div>
        <div className="field"><label htmlFor="schedule-type">Machine type</label>
          <select id="schedule-type" value={machineType} onChange={(event) => setMachineType(event.target.value)}>
            <option value="">All</option>{machineTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select></div>
        <button type="button" className="button" onClick={() => { setFrom(addDays(todayIso(), -1)); setTo(addDays(todayIso(), 13)); }}>Next 2 weeks</button>
      </div>
      {!rangeIsValid ? <p className="error-text">“From” must be before “To”.</p> : (
        <section className="card compact">
          <QueryState query={scheduleQuery} rows={8}>
            {(schedule) => {
              const bars: GanttBar[] = [
                ...schedule.maintenance.map((window, index) => ({
                  id: `maintenance-${index}`, lane: window.machine_id, label: window.maintenance_type === "breakdown" ? "Down" : "Maintenance",
                  start: window.start_at, end: window.end_at ?? `${to}T23:59:00Z`, tone: "maintenance" as const,
                })),
                ...schedule.slots.map((slot) => ({
                  id: slot.id, lane: slot.machine_id, label: `${slot.order_number.replace(/^SO-\d{4}-/, "")}${slot.is_overtime ? " OT" : ""}`, start: slot.start_at, end: slot.end_at,
                  tone: slot.status, onClick: () => navigate(`/orders/${slot.order_id}`),
                })),
              ];
              return machines.length === 0 ? <p className="empty-state">No machines.</p> : (
                <>
                  <MiniGantt lanes={machines.map((machine) => ({ key: machine.id, label: `${machine.code} · ${machine.name}` }))} bars={bars}
                    from={`${from}T00:00:00Z`} to={`${to}T23:59:59Z`} ariaLabel="Machine schedule" />
                  <div className="gantt-legend">
                    <span><i className="gantt-locked" /> Locked</span><span><i className="gantt-tentative" /> Tentative</span>
                    <span><i className="gantt-done" /> Done</span><span><i className="gantt-maintenance" /> Down or maintenance</span>
                    <span><i className="gantt-today" style={{ position: "static", width: 2, height: 10 }} /> Now</span>
                  </div>
                </>
              );
            }}
          </QueryState>
        </section>
      )}
    </div>
  );
}
