// Right-hand panels: settings of the selected block or link, the job list, and the results.
import { useEffect, useState, type ReactNode } from "react";
import {
  MACHINE_TYPES, formatDuration, formatSimTime, machineTypeInfo,
  type DesignProblem, type LineBlock, type LineDesign, type LineJob, type SimulationResult,
} from "./engine";
import type { Selection } from "./LineCanvas";
import { makeJob, removeBlock, updateBlock } from "./model";

/** Number input that lets the user type freely ("1.", "") and only reports valid numbers. */
function NumberInput({ id, value, onChange, min = 0, max, step = "any", integer = false }: {
  id: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: string; integer?: boolean;
}) {
  const [text, setText] = useState(String(value));
  // Follow outside changes (another block selected, type changed) without fighting the user's typing.
  useEffect(() => { if (Number(text) !== value) setText(String(value)); }, [value]);
  return (
    <input id={id} type="number" inputMode="decimal" min={min} max={max} step={step} value={text}
      onChange={(event) => {
        setText(event.target.value);
        const parsed = Number(event.target.value);
        if (event.target.value.trim() === "" || !Number.isFinite(parsed)) return;
        let next = Math.max(min, parsed);
        if (max !== undefined) next = Math.min(max, next);
        onChange(integer ? Math.round(next) : next);
      }} />
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div className="field"><label htmlFor={id}>{label}</label>{children}</div>;
}

export function SettingsPanel({ design, selection, onChange, onSelect, problems }: {
  design: LineDesign; selection: Selection; onChange: (design: LineDesign) => void;
  onSelect: (selection: Selection) => void; problems: DesignProblem[];
}) {
  if (selection?.kind === "link") {
    const link = design.links.find((item) => item.id === selection.id);
    if (!link) return null;
    const name = (blockId: string) => design.blocks.find((block) => block.id === blockId)?.name ?? "?";
    return (
      <div className="stack">
        <p>Link from <strong>{name(link.from)}</strong> to <strong>{name(link.to)}</strong>.</p>
        <button type="button" className="button button-danger" onClick={() => {
          onChange({ ...design, links: design.links.filter((item) => item.id !== link.id) });
          onSelect(null);
        }}>Remove link</button>
      </div>
    );
  }

  const block = selection?.kind === "block" ? design.blocks.find((item) => item.id === selection.id) : undefined;
  if (!block) {
    return (
      <div className="stack small">
        <p className="muted" style={{ margin: 0 }}>
          Add blocks from the left. Drag a block to move it. Drag from the round port on its right side to another block to link them.
          Click a block to change its settings.
        </p>
        {problems.length > 0 ? (
          <div className="banner banner-warning" role="alert">
            <strong>Fix these before running:</strong>
            <ul className="ls-problem-list">{problems.map((problem) => <li key={problem.message}>{problem.message}</li>)}</ul>
          </div>
        ) : null}
      </div>
    );
  }

  const change = (changes: Partial<LineBlock>) => onChange(updateBlock(design, block.id, changes));
  return (
    <div>
      <Field id="ls-name" label="Name">
        <input id="ls-name" value={block.name} maxLength={60} onChange={(event) => change({ name: event.target.value })} />
      </Field>
      {block.kind === "machine" ? (
        <>
          <Field id="ls-type" label="Machine type">
            <select id="ls-type" value={block.machineType} onChange={(event) => {
              const info = machineTypeInfo(event.target.value);
              change({ machineType: info.type, cycleSeconds: info.cycleSeconds, setupMinutes: info.setupMinutes });
            }}>
              {MACHINE_TYPES.map((info) => <option key={info.type} value={info.type}>{info.label}</option>)}
            </select>
          </Field>
          <div className="ls-field-grid">
            <Field id="ls-cycle" label="Cycle time per part (s)">
              <NumberInput id="ls-cycle" value={block.cycleSeconds} max={86_400} onChange={(value) => change({ cycleSeconds: value })} />
            </Field>
            <Field id="ls-setup" label="Setup per job (min)">
              <NumberInput id="ls-setup" value={block.setupMinutes} max={10_000} onChange={(value) => change({ setupMinutes: value })} />
            </Field>
            <Field id="ls-scrap" label="Scrap (%)">
              <NumberInput id="ls-scrap" value={block.scrapPercent} max={100} onChange={(value) => change({ scrapPercent: value })} />
            </Field>
            <Field id="ls-breakdowns" label="Breakdowns per day">
              <NumberInput id="ls-breakdowns" value={block.breakdownsPerDay} max={100} onChange={(value) => change({ breakdownsPerDay: value })} />
            </Field>
            <Field id="ls-repair" label="Repair time (min)">
              <NumberInput id="ls-repair" value={block.repairMinutes} max={10_000} onChange={(value) => change({ repairMinutes: value })} />
            </Field>
          </div>
        </>
      ) : (
        <p className="small muted">{block.kind === "source" ? "Parts of every job start here." : "Finished parts leave the line here."}</p>
      )}
      <button type="button" className="button button-danger" onClick={() => { onChange(removeBlock(design, block.id)); onSelect(null); }}>
        Remove block
      </button>
    </div>
  );
}

export function JobsPanel({ design, onChange }: { design: LineDesign; onChange: (design: LineDesign) => void }) {
  const change = (jobId: string, changes: Partial<LineJob>) =>
    onChange({ ...design, jobs: design.jobs.map((job) => job.id === jobId ? { ...job, ...changes } : job) });
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>Hours count from the start of the simulation (Day 1, 00:00).</p>
      {design.jobs.map((job, index) => (
        <div key={job.id} className="ls-job card compact">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className={`ls-job-swatch ls-job-${index % 6}`} aria-hidden="true" />
            <input aria-label="Job name" className="inline-input" style={{ flex: 1 }} value={job.name} maxLength={60}
              onChange={(event) => change(job.id, { name: event.target.value })} />
            <button type="button" className="button button-small" aria-label={`Remove ${job.name}`}
              onClick={() => onChange({ ...design, jobs: design.jobs.filter((item) => item.id !== job.id) })}>Remove</button>
          </div>
          <div className="ls-field-grid ls-field-grid-3">
            <Field id={`ls-qty-${job.id}`} label="Quantity">
              <NumberInput id={`ls-qty-${job.id}`} value={job.quantity} min={1} max={20_000} step="1" integer
                onChange={(value) => change(job.id, { quantity: value })} />
            </Field>
            <Field id={`ls-start-${job.id}`} label="Start (hour)">
              <NumberInput id={`ls-start-${job.id}`} value={job.startHour} max={8_760} onChange={(value) => change(job.id, { startHour: value })} />
            </Field>
            <Field id={`ls-due-${job.id}`} label="Due (hour)">
              <NumberInput id={`ls-due-${job.id}`} value={job.dueHour} max={8_760} onChange={(value) => change(job.id, { dueHour: value })} />
            </Field>
          </div>
        </div>
      ))}
      <button type="button" className="button" onClick={() => onChange({ ...design, jobs: [...design.jobs, makeJob(design)] })}
        disabled={design.jobs.length >= 100}>Add job</button>
    </div>
  );
}

export function ResultsPanel({ result, design, unreachableNames }: {
  result: SimulationResult | null; design: LineDesign; unreachableNames: string[];
}) {
  if (!result) return <p className="small muted">Press Run to see results.</p>;
  const bottleneck = result.machines.find((machine) => machine.blockId === result.bottleneckId);
  const nameOf = (blockId: string) => design.blocks.find((block) => block.id === blockId)?.name ?? "";
  return (
    <div className="stack" data-testid="line-results">
      {!result.finished ? (
        <div className="banner banner-warning" role="alert">The line did not finish within 365 days. Some jobs are not done.</div>
      ) : null}
      {unreachableNames.length > 0 ? (
        <div className="banner banner-warning">No parts can reach: {unreachableNames.join(", ")}.</div>
      ) : null}
      <div className="ls-tiles">
        <div><div className="kpi-label">All done</div><div className="ls-tile-value">{formatSimTime(result.endSeconds)}</div>
          <div className="small muted">{formatDuration(result.endSeconds)}</div></div>
        <div><div className="kpi-label">Good parts</div><div className="ls-tile-value">{result.goodParts.toLocaleString()}</div>
          <div className="small muted">{result.scrappedParts.toLocaleString()} scrapped</div></div>
        <div><div className="kpi-label">Parts per hour</div><div className="ls-tile-value">{result.partsPerHour}</div></div>
        <div><div className="kpi-label">Bottleneck</div><div className="ls-tile-value">{bottleneck ? nameOf(bottleneck.blockId) : "None"}</div>
          {bottleneck ? <div className="small muted">{bottleneck.busyPercent}% busy</div> : null}</div>
      </div>

      <div>
        <h3 className="section-title">Jobs</h3>
        <div className="ls-table-wrap"><table className="data-table ls-table">
          <thead><tr><th>Job</th><th>Good</th><th>Done at</th><th>Due</th><th /></tr></thead>
          <tbody>
            {result.jobs.map((job) => (
              <tr key={job.jobId}>
                <td>{job.name}</td>
                <td>{job.good}/{job.quantity}</td>
                <td>{job.finishSeconds === null ? "Not done" : formatSimTime(job.finishSeconds)}</td>
                <td>{formatSimTime(job.dueSeconds)}</td>
                <td>{job.late ? <span className="badge badge-problem">Late</span> : <span className="badge badge-done">On time</span>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      <div>
        <h3 className="section-title">Machines</h3>
        <div className="ls-table-wrap"><table className="data-table ls-table">
          <thead><tr><th>Machine</th><th>Busy</th><th>Setup</th><th>Down</th><th>Parts</th><th>Max queue</th></tr></thead>
          <tbody>
            {result.machines.map((machine) => (
              <tr key={machine.blockId} className={machine.blockId === result.bottleneckId ? "ls-row-bottleneck" : undefined}>
                <td>{nameOf(machine.blockId)}</td>
                <td>
                  <div className="ls-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, machine.busyPercent)}%` }} /></div>
                  {machine.busyPercent}%
                </td>
                <td>{machine.setupPercent}%</td>
                <td>{machine.downPercent}%</td>
                <td>{machine.partsMade}{machine.partsScrapped ? <span className="small muted"> (+{machine.partsScrapped} scrap)</span> : null}</td>
                <td>{machine.maxQueue}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
