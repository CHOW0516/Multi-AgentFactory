import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { apiFetch } from "../../api/client";
import type { FloorMachine, FloorOut, JobRef, MachineOverview, MachineStatus } from "../../api/types";
import { formatDateTime, percent, QueryNotice } from "../../figures/figure-ui";
import { useAuthStore } from "../../shell/auth-store";
import { Icon } from "../../shell/icons";
import { floorKey, overviewKey, statusNames, withMachineStatus } from "./model";

function Job({ job }: { job: JobRef }) {
  return <><strong>{job.order_number}</strong> · {job.quantity} parts
    <small>{formatDateTime(job.start_at)} – {formatDateTime(job.end_at)}</small></>;
}

export function MachineDrawer({ machine, onClose, onLocate }: { machine: FloorMachine; onClose: () => void; onLocate: () => void }) {
  const client = useQueryClient();
  const role = useAuthStore((state) => state.user?.role);
  const canOperate = role === "manager" || role === "admin" || role === "planner";
  const path = `/machines/${encodeURIComponent(machine.id)}`;
  const details = useQuery({
    queryKey: overviewKey(machine.id), queryFn: ({ signal }) => apiFetch<MachineOverview>(`${path}/overview`, { signal }),
  });
  const [action, setAction] = useState<"status" | "breakdown" | null>(null);
  const [status, setStatus] = useState(machine.status);
  const [note, setNote] = useState("");
  const [hours, setHours] = useState("");
  const [saved, setSaved] = useState(false);
  const statusId = useId();
  const titleId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => closeButton.current?.focus({ preventScroll: true }), []);
  const update = useMutation({
    mutationFn: (command: { action: "status" | "breakdown"; status: MachineStatus; note: string; hours: string }) =>
      apiFetch(`${path}/${command.action}`, { method: "POST", body: command.action === "status" ? { status: command.status } :
        { note: command.note.trim() || null, expected_hours: command.hours === "" ? null : Number(command.hours) } }),
    onSuccess: (_, command) => {
      const nextStatus = command.action === "status" ? command.status : "down";
      client.setQueryData<FloorOut>(floorKey, (previous) => withMachineStatus(previous, machine.id, nextStatus));
      client.setQueryData<MachineOverview>(overviewKey(machine.id), (previous) =>
        previous && { ...previous, machine: { ...previous.machine, status: nextStatus } });
      void client.invalidateQueries({ queryKey: floorKey });
      void client.invalidateQueries({ queryKey: overviewKey(machine.id) });
      setAction(null);
      setSaved(true);
    },
  });
  const current = details.data;
  const currentStatus = current?.machine.status ?? machine.status;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (action && !update.isPending) update.mutate({ action, status, note, hours });
  }

  return <section className="floor-inspector floor-panel" role="dialog" aria-labelledby={titleId} data-testid="machine-drawer">
    <header className="floor-inspector-header">
      <span className="floor-tile-icon"><Icon name="factory" size={23} /></span>
      <div className="floor-inspector-title"><span>{machine.code}</span><h2 id={titleId}>{machine.name}</h2></div>
      <button type="button" className="icon-button" aria-label="Focus machine" title="Focus machine" onClick={onLocate}><Icon name="focus" size={17} /></button>
      <button type="button" ref={closeButton} className="icon-button" aria-label="Close details" title="Close details" onClick={onClose}><Icon name="close" size={16} /></button>
    </header>
    <div className="floor-inspector-body">
    <div className="floor-inspector-state">
      <span className="floor-status" data-status={currentStatus}><i />{statusNames[currentStatus]}</span>
      <span>{machine.current_order_number ?? "No active order"}</span>
    </div>
    <QueryNotice pending={details.isPending} error={details.isError} retry={() => void details.refetch()} />
    {current && <>
      <dl className="floor-inspector-metrics">
        <div><dt>Utilisation today</dt><dd>{percent(current.utilisation_today)}</dd>
          <progress max={1} value={current.utilisation_today} aria-label="Machine utilisation" /></div>
        <div><dt>Parts recorded</dt><dd>{machine.part_count.toLocaleString()}</dd></div>
      </dl>
      <section><h3>Current job</h3><p className="floor-current-job">{current.current_job ? <Job job={current.current_job} /> : "No current job"}</p></section>
      <section><h3>Next jobs</h3><ul className="p5-list">{current.next_jobs.length ? current.next_jobs.map((job) =>
        <li key={`${job.order_id}-${job.start_at}`}><Job job={job} /></li>) : <li>No jobs scheduled.</li>}</ul></section>
      <section><h3>Recent events</h3><ul className="p5-list">{current.recent_events.length ? current.recent_events.map((entry) =>
        <li key={entry.id}><strong>{entry.event_type.replaceAll("_", " ")}</strong> · {entry.value}<small>{formatDateTime(entry.happened_at)}</small></li>) : <li>No recent events.</li>}</ul></section>
      <section><h3>Maintenance history</h3><ul className="p5-list">{current.maintenance_history.length ? current.maintenance_history.map((entry) =>
        <li key={`${entry.start_at}-${entry.maintenance_type}`}><strong>{entry.maintenance_type}</strong><small>{formatDateTime(entry.start_at)}{entry.end_at ? ` – ${formatDateTime(entry.end_at)}` : " · Ongoing"}</small></li>) : <li>No maintenance recorded.</li>}</ul></section>
    </>}
    {canOperate && <section>
      <div className="p5-actions">
        <button className="button" disabled={update.isPending} onClick={() => { setStatus(currentStatus); setAction("status"); update.reset(); setSaved(false); }}>Set status</button>
        <button className="button" disabled={update.isPending} onClick={() => { setNote(""); setHours(""); setAction("breakdown"); update.reset(); setSaved(false); }}>Log breakdown</button>
      </div>
      {saved && <p className="p5-notice" role="status">Machine updated.</p>}
      {action && <form className="p5-edit" onSubmit={submit}>
        {action === "status" ? <div className="p5-replay-field"><label htmlFor={statusId}>Status</label>
          <select id={statusId} value={status} onChange={(event) => setStatus(event.target.value as MachineStatus)}>
            {Object.entries(statusNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></div> : <>
          <label>Breakdown note<textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} /></label>
          <label>Estimated downtime (hours)<input type="number" min="0.25" step="0.25" value={hours} onChange={(event) => setHours(event.target.value)} /></label>
        </>}
        {update.isError && <p className="error-text" role="alert">{update.error.message}</p>}
        <button className="button button-primary" disabled={update.isPending} type="submit">{update.isPending ? "Saving…" : "Save"}</button>
      </form>}
    </section>}
    </div>
  </section>;
}
