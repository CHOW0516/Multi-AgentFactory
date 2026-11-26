import "./line-simulator.css";
// Line simulator: build your own machine line on a canvas and watch orders flow through it.
// A sandbox: nothing here changes real machines, orders or the schedule. No AI is used.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../../api/client";
import type { MachineOut } from "../../api/types";
import { Dialog } from "../../components/Dialog";
import { PageHeader } from "../../components/PageHeader";
import {
  MACHINE_TYPES, formatSimTime, queueAt, simulate, stateAt, unreachableBlocks, validateDesign,
  type DesignProblem, type LineDesign, type MachineState, type SimulationResult,
} from "./engine";
import { LineCanvas, type PlaybackView, type Selection } from "./LineCanvas";
import {
  designFromMachines, freeSpot, makeBlock, newDesign, paletteLabel,
  type PaletteItem, type SimLineOut, type SimLineSummary,
} from "./model";
import { JobsPanel, ResultsPanel, SettingsPanel } from "./Panels";

const PALETTE: PaletteItem[] = ["source", ...MACHINE_TYPES.map((info) => info.type), "sink"];
const SPEEDS = [
  { value: 60, label: "1 min per second" },
  { value: 600, label: "10 min per second" },
  { value: 3600, label: "1 hour per second" },
  { value: 21_600, label: "6 hours per second" },
  { value: 86_400, label: "1 day per second" },
];
const DOT_SECONDS = 0.6;       // how long (real time) a dot takes to travel a link
const MAX_DOTS = 80;
const MAX_NEW_DOTS_PER_FRAME = 12;

type Tab = "settings" | "jobs" | "results";
interface Dot { id: number; from: string; to: string; jobIndex: number; bornAt: number }
interface Confirm { title: string; message: string; confirmLabel: string; danger?: boolean; run: () => void }

export function LineSimulatorPage() {
  const queryClient = useQueryClient();
  const [lineId, setLineId] = useState<string | null>(null);
  const [name, setName] = useState("New line");
  const [design, setDesign] = useState<LineDesign>(newDesign);
  const [dirty, setDirty] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [tab, setTab] = useState<Tab>("settings");
  const [problems, setProblems] = useState<DesignProblem[]>([]);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // playback
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [clock, setClock] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(600);
  const [dots, setDots] = useState<Dot[]>([]);
  const moveIndex = useRef(0);
  const nextDotId = useRef(0);

  const linesQuery = useQuery({ queryKey: ["sim-lines"], queryFn: () => apiFetch<SimLineSummary[]>("/sim-lines") });

  /** Every design change goes through here: it marks unsaved and drops an old result. */
  function changeDesign(next: LineDesign) {
    setDesign(next);
    setDirty(true);
    if (result) stopPlayback();
    if (problems.length) setProblems(validateDesign(next));
  }

  function stopPlayback() {
    setResult(null);
    setPlaying(false);
    setClock(0);
    setDots([]);
    moveIndex.current = 0;
  }

  function loadDesign(nextDesign: LineDesign, nextName: string, nextId: string | null) {
    stopPlayback();
    setDesign(nextDesign);
    setName(nextName);
    setLineId(nextId);
    setDirty(false);
    setSelection(null);
    setProblems([]);
    setTab("settings");
  }

  /** Ask before throwing away unsaved changes. */
  function guardUnsaved(run: () => void) {
    if (!dirty) { run(); return; }
    setConfirm({ title: "Discard changes?", message: "This line has changes that are not saved.", confirmLabel: "Discard", danger: true, run });
  }

  const save = useMutation({
    mutationFn: ({ asNew }: { asNew: boolean }) => {
      const body = { name: name.trim() || "Untitled line", design };
      return lineId && !asNew
        ? apiFetch<SimLineOut>(`/sim-lines/${lineId}`, { method: "PUT", body })
        : apiFetch<SimLineOut>("/sim-lines", { method: "POST", body });
    },
    onSuccess: (saved) => {
      setLineId(saved.id);
      setName(saved.name);
      setDirty(false);
      setMessage(`Saved "${saved.name}".`);
      void queryClient.invalidateQueries({ queryKey: ["sim-lines"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/sim-lines/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      loadDesign(newDesign(), "New line", null);
      setMessage("Line deleted.");
      void queryClient.invalidateQueries({ queryKey: ["sim-lines"] });
    },
  });

  const open = useMutation({
    mutationFn: (id: string) => apiFetch<SimLineOut>(`/sim-lines/${id}`),
    onSuccess: (line) => { loadDesign(line.design, line.name, line.id); setMessage(null); },
  });

  const fromFactory = useMutation({
    mutationFn: () => apiFetch<MachineOut[]>("/machines"),
    onSuccess: (machines) => {
      loadDesign(designFromMachines(machines), "My factory", null);
      setDirty(true);
      setMessage(`Added ${machines.length} machines from your factory. Link them to build the line.`);
    },
  });

  function addBlock(item: PaletteItem, x?: number, y?: number) {
    const spot = x === undefined || y === undefined ? freeSpot(design) : { x, y };
    const block = makeBlock(design, item, spot.x, spot.y);
    changeDesign({ ...design, blocks: [...design.blocks, block] });
    setSelection({ kind: "block", id: block.id });
    setTab("settings");
  }

  function run() {
    const found = validateDesign(design);
    setProblems(found);
    if (found.length) { setTab("settings"); setSelection(null); return; }
    const simulated = simulate(design);
    moveIndex.current = 0;
    setDots([]);
    setClock(0);
    setResult(simulated);
    setPlaying(true);
    setTab("results");
  }

  // Animation loop: move the clock forward and spawn dots for parts that moved.
  const latest = useRef({ clock, speed, result, dots });
  latest.current = { clock, speed, result, dots };
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let lastTime = performance.now();
    const tick = (now: number) => {
      const state = latest.current;
      const current = state.result;
      if (!current) return;
      const realSeconds = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      const nextClock = Math.min(current.endSeconds, state.clock + realSeconds * state.speed);

      const alive = state.dots.filter((dot) => (now - dot.bornAt) / 1000 < DOT_SECONDS);
      let spawned = 0;
      while (moveIndex.current < current.moves.length && current.moves[moveIndex.current].time <= nextClock) {
        const move = current.moves[moveIndex.current++];
        if (alive.length < MAX_DOTS && spawned < MAX_NEW_DOTS_PER_FRAME) {
          alive.push({ id: nextDotId.current++, from: move.from, to: move.to, jobIndex: move.jobIndex, bornAt: now });
          spawned++;
        }
      }
      setClock(nextClock);
      setDots(alive);
      if (nextClock >= current.endSeconds && alive.length === 0) { setPlaying(false); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  function skipToEnd() {
    if (!result) return;
    setPlaying(false);
    setClock(result.endSeconds);
    moveIndex.current = result.moves.length;
    setDots([]);
  }

  function restart() {
    if (!result) return;
    moveIndex.current = 0;
    setDots([]);
    setClock(0);
    setPlaying(true);
  }

  const sinkTimes = useMemo(() => {
    const times: Record<string, number[]> = {};
    for (const move of result?.moves ?? []) {
      if (design.blocks.find((block) => block.id === move.to)?.kind === "sink") (times[move.to] ??= []).push(move.time);
    }
    return times;
  }, [result, design]);

  const playback: PlaybackView | null = useMemo(() => {
    if (!result) return null;
    const states: Record<string, MachineState> = {};
    const queues: Record<string, number> = {};
    for (const machine of result.machines) {
      states[machine.blockId] = stateAt(machine.periods, clock);
      queues[machine.blockId] = queueAt(machine.queueChanges, clock);
    }
    const shipped: Record<string, number> = {};
    for (const [sinkId, times] of Object.entries(sinkTimes)) {
      shipped[sinkId] = countUpTo(times, clock);
    }
    const now = performance.now();
    return {
      states, queues, shipped,
      bottleneckId: clock >= result.endSeconds ? result.bottleneckId : null,
      dots: dots.map((dot) => ({ ...dot, progress: Math.min(1, (now - dot.bornAt) / 1000 / DOT_SECONDS) })),
    };
  }, [result, clock, dots, sinkTimes]);

  const unreachableNames = useMemo(
    () => result ? unreachableBlocks(design).map((block) => block.name) : [], [result, design]);
  const lines = linesQuery.data ?? [];

  return (
    <div className="ls-page">
      <PageHeader title="Line simulator"
        subtitle="Build your own machine line and see how orders flow through it. This is a sandbox: it does not change real machines, orders or the schedule."
        actions={<>
          <select aria-label="Open a saved line" className="ls-select" value=""
            onChange={(event) => { const id = event.target.value; if (id) guardUnsaved(() => open.mutate(id)); }}>
            <option value="">{lines.length ? "Open saved line…" : "No saved lines"}</option>
            {lines.map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}
          </select>
          <button type="button" className="button" onClick={() => guardUnsaved(() => { loadDesign(newDesign(), "New line", null); setMessage(null); })}>New</button>
          <button type="button" className="button" disabled={fromFactory.isPending}
            onClick={() => guardUnsaved(() => fromFactory.mutate())}>Start from my factory</button>
        </>} />

      <div className="ls-toolbar card compact">
        <input aria-label="Line name" className="inline-input ls-name" value={name} maxLength={120}
          onChange={(event) => { setName(event.target.value); setDirty(true); }} />
        {dirty ? <span className="small muted">Not saved</span> : null}
        <button type="button" className="button button-primary" disabled={save.isPending} onClick={() => save.mutate({ asNew: false })}>Save</button>
        {lineId ? <button type="button" className="button" disabled={save.isPending} onClick={() => save.mutate({ asNew: true })}>Save as new</button> : null}
        {lineId ? (
          <button type="button" className="button" onClick={() => setConfirm({
            title: "Delete line?", message: `"${name}" will be deleted for everyone.`, confirmLabel: "Delete", danger: true,
            run: () => remove.mutate(lineId),
          })}>Delete</button>
        ) : null}
        <span className="ls-toolbar-gap" />
        <button type="button" className="button button-primary" onClick={run} data-testid="line-run">Run</button>
        {result ? (
          <>
            <button type="button" className="button" onClick={() => playing ? setPlaying(false) : clock >= result.endSeconds ? restart() : setPlaying(true)}>
              {playing ? "Pause" : clock >= result.endSeconds ? "Replay" : "Play"}
            </button>
            <button type="button" className="button" onClick={skipToEnd} disabled={clock >= result.endSeconds}>Skip to end</button>
          </>
        ) : null}
        <select aria-label="Speed" className="ls-select" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
          {SPEEDS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <span className="ls-clock mono" aria-live="off" data-testid="line-clock">{formatSimTime(clock)}</span>
      </div>

      {message ? <p className="small muted" role="status" style={{ margin: "0 0 8px" }}>{message}</p> : null}
      {save.isError ? <p className="error-text" role="alert">Could not save: {save.error.message}</p> : null}
      {open.isError ? <p className="error-text" role="alert">Could not open the line: {open.error.message}</p> : null}
      {fromFactory.isError ? <p className="error-text" role="alert">Could not load machines: {fromFactory.error.message}</p> : null}
      {remove.isError ? <p className="error-text" role="alert">Could not delete: {remove.error.message}</p> : null}

      <div className="ls-layout">
        <aside className="ls-palette card compact" aria-label="Blocks you can add">
          <h2 className="section-title">Add</h2>
          {PALETTE.map((item) => (
            <button key={item} type="button" className="ls-palette-item" draggable
              onDragStart={(event) => { event.dataTransfer.setData("application/x-line-block", item); event.dataTransfer.effectAllowed = "copy"; }}
              onClick={() => addBlock(item)}>
              <span className={`ls-palette-mark ls-palette-${item === "source" || item === "sink" ? item : "machine"}`} aria-hidden="true" />
              {paletteLabel(item)}
            </button>
          ))}
          <p className="small muted ls-legend">
            <span><i className="ls-state-running" /> Running</span>
            <span><i className="ls-state-setup" /> Setup</span>
            <span><i className="ls-state-idle" /> Idle</span>
            <span><i className="ls-state-down" /> Down</span>
          </p>
        </aside>

        <div className="ls-canvas-wrap card">
          <LineCanvas design={design} onChange={changeDesign} selection={selection} playback={playback}
            onSelect={(next) => { setSelection(next); if (next) setTab("settings"); }}
            onDropItem={(item, x, y) => addBlock(item, x, y)} />
        </div>

        <aside className="ls-side card compact" aria-label="Line details">
          <div className="tabs" role="tablist" aria-label="Line details">
            {(["settings", "jobs", "results"] as Tab[]).map((key) => (
              <button key={key} type="button" role="tab" className="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
                {key === "settings" ? "Settings" : key === "jobs" ? `Jobs (${design.jobs.length})` : "Results"}
              </button>
            ))}
          </div>
          {tab === "settings" ? (
            <SettingsPanel design={design} selection={selection} onChange={changeDesign} onSelect={setSelection} problems={problems} />
          ) : tab === "jobs" ? (
            <JobsPanel design={design} onChange={changeDesign} />
          ) : (
            <ResultsPanel result={result} design={design} unreachableNames={unreachableNames} />
          )}
        </aside>
      </div>

      <Dialog open={confirm !== null} title={confirm?.title ?? ""} onClose={() => setConfirm(null)}
        footer={<>
          <button type="button" className="button" onClick={() => setConfirm(null)}>Cancel</button>
          <button type="button" className={`button ${confirm?.danger ? "button-danger" : "button-primary"}`}
            onClick={() => { const action = confirm?.run; setConfirm(null); action?.(); }}>{confirm?.confirmLabel}</button>
        </>}>
        <p>{confirm?.message}</p>
      </Dialog>
    </div>
  );
}

/** How many sorted times are at or before `limit`. */
function countUpTo(times: number[], limit: number): number {
  let low = 0, high = times.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (times[middle] <= limit) low = middle + 1;
    else high = middle;
  }
  return low;
}
