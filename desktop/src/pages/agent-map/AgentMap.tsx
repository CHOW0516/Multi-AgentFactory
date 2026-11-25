import { Select } from "../../components/Select";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { apiFetch, USE_MOCKS, useLiveEvents } from "../../api/client";
import type { AgentMessageEventData, AgentMessageOut, AgentSummary, HealthOut, OrderSummary, Page } from "../../api/types";
import { stationArt, stations, type MapAgent, type Station } from "../../figures/agent-geometry";
import { demoOrders, useDemoEvents } from "../../figures/demo-events";
import { itemsOf, QueryNotice } from "../../figures/figure-ui";
import { SceneMetric } from "../factory-floor/FactoryFloor";
import { Icon } from "../../shell/icons";
import { useThemeStore } from "../../theme/theme-store";
import "./agent-map.css";
import { AgentDrawer } from "./AgentDrawer";
import { MapScene, type ReplayMotion } from "./MapScene";
import { pendingTasks, replayPlan, type Message, type Selection } from "./model";

const emptyMessages: Message[] = [];

function clockLabel(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function useTraffic() {
  const [recent, setRecent] = useState<AgentMessageEventData[]>([]);
  const [now, setNow] = useState(Date.now);
  const observed = useRef(new Map<string, { at: number; failed: boolean }>());
  useLiveEvents(["agent_message"], (event) => {
    const message = event.data as AgentMessageEventData;
    if (observed.current.has(message.message_id)) return;
    const at = Date.parse(message.sent_at);
    observed.current.set(message.message_id, { at: Number.isFinite(at) ? at : Date.now(), failed: message.status === "failed" });
    setRecent((previous) => [...previous.slice(-149), message]);
    setNow(Date.now());
  });
  useEffect(() => {
    const timer = window.setInterval(() => {
      const date = new Date();
      const current = date.getTime();
      const midnight = date.setHours(0, 0, 0, 0);
      const old = Math.min(midnight, current - 60_000);
      for (const [id, message] of observed.current) if (message.at < old) observed.current.delete(id);
      if (document.visibilityState !== "hidden") setNow(current);
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);
  const today = new Date(now).setHours(0, 0, 0, 0);
  let rate = 0;
  let failed = 0;
  for (const message of observed.current.values()) {
    if (message.at >= now - 60_000) rate++;
    if (message.failed && message.at >= today) failed++;
  }
  return { recent, rate, failed };
}

export function AgentMap() {
  const summary = useQuery({
    queryKey: ["p5", "agents"], queryFn: async ({ signal }) => itemsOf(await apiFetch<AgentSummary[] | Page<AgentSummary>>("/agents", { signal })),
    refetchInterval: 15_000,
  });
  const health = useQuery({
    queryKey: ["p5", "health"], queryFn: ({ signal }) => apiFetch<HealthOut>("/health", { signal }), enabled: !USE_MOCKS,
  });
  const orders = useQuery({
    queryKey: ["p5", "orders"], queryFn: async ({ signal }) => USE_MOCKS ? demoOrders :
      itemsOf(await apiFetch<OrderSummary[] | Page<OrderSummary>>("/orders?page=1&page_size=100", { signal })),
  });
  const theme = useThemeStore((state) => state.theme);
  const restoreFocus = useRef<HTMLElement | SVGElement | null>(null);
  const [focus, setFocus] = useState<Selection | null>(null);
  const [search, setSearch] = useState("");
  const [rosterOpen, setRosterOpen] = useState(() => window.matchMedia?.("(min-width: 720px)")?.matches ?? true);
  const [hover, setHover] = useState<MapAgent | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [order, setOrder] = useState("");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 4>(1);
  const [, refreshReplay] = useState(0);
  const orderControl = useId();
  const speedControl = useId();
  const position = useRef(0);
  const slider = useRef<HTMLInputElement>(null);
  const elapsed = useRef<HTMLOutputElement>(null);
  const showSimulator = USE_MOCKS || health.data?.app_mode === "demo";
  const names = useMemo(() => stations.filter((name) => name !== "simulator" || showSimulator), [showSimulator]);

  useDemoEvents();
  const { recent, rate, failed } = useTraffic();
  const history = useQuery({
    queryKey: ["p5", "order-messages", order], enabled: Boolean(order),
    queryFn: async ({ signal }) => itemsOf(await apiFetch<AgentMessageOut[] | Page<AgentMessageOut>>(`/orders/${encodeURIComponent(order)}/messages`, { signal })),
  });
  const plan = useMemo(() => replayPlan(history.data ?? emptyMessages), [history.data]);
  const inspect = useCallback((next: Selection) => {
    const trigger = document.activeElement;
    if ((trigger instanceof HTMLElement || trigger instanceof SVGElement) && trigger !== document.body && !trigger.closest(".floor-inspector")) restoreFocus.current = trigger;
    setSelection(next); setFocus(next);
  }, []);
  const onStation = useCallback((name: MapAgent) => inspect({ type: "station", name }), [inspect]);
  const onRail = useCallback((name: Station) => inspect({ type: "rail", name }), [inspect]);
  const closeInspector = () => {
    setSelection(null);
    requestAnimationFrame(() => {
      if (restoreFocus.current?.isConnected) restoreFocus.current.focus({ preventScroll: true });
      else document.querySelector<SVGSVGElement>(".agent-workspace .floor-model")?.focus({ preventScroll: true });
    });
  };
  const onEnd = useCallback(() => setPlaying(false), []);

  const writeTime = useCallback((next: number) => {
    position.current = next;
    if (slider.current && (Math.abs(Number(slider.current.value) - next) >= 100 || next === Number(slider.current.max))) {
      slider.current.value = String(next);
      slider.current.setAttribute("aria-valuetext", clockLabel(next));
    }
    if (elapsed.current && elapsed.current.value !== clockLabel(next)) elapsed.current.value = clockLabel(next);
  }, []);

  function seek(next: number) {
    writeTime(next);
    if (slider.current) {
      slider.current.value = String(next);
      slider.current.setAttribute("aria-valuetext", clockLabel(next));
    }
    refreshReplay((previous) => previous + 1);
  }

  const motion: ReplayMotion | null = order ? {
    parcels: plan.parcels, end: plan.end, position, speed, playing, onTick: writeTime, onEnd,
  } : null;
  const inProgress = summary.data?.reduce((sum, agent) =>
    sum + (agent.name === "orchestrator" || names.includes(agent.name as Station) ? agent.in_progress : 0), 0);
  const liveTasks = pendingTasks(recent).length;
  const activeTasks = Math.max(inProgress ?? 0, liveTasks);

  return <section className="floor-workspace agent-workspace p5-page iso" data-theme={theme} data-inspecting={Boolean(selection) || undefined}
    onKeyDown={(event) => { if (event.key === "Escape" && selection) { event.stopPropagation(); closeInspector(); } }}>
    <MapScene names={names} summaries={summary.data ?? []} live={recent} replay={motion}
      onStation={onStation} onRail={onRail} focus={focus} selection={selection} hover={hover} onHover={setHover} />
    <header className="floor-overview">
      <h1>Agent map</h1>
      <dl className="floor-metrics">
        <SceneMetric icon="agents" label="Messages / min" value={rate} />
        <SceneMetric icon="orders" label="Tasks in progress" value={summary.data || liveTasks ? activeTasks : "—"} />
        <SceneMetric icon="quality" label="Failures observed today" value={failed} />
      </dl>
      <QueryNotice pending={summary.isPending} error={summary.isError} retry={() => void summary.refetch()} />
    </header>
    <div className="floor-guide floor-panel">
      <div className="floor-guide-title"><Icon name="orbit" size={17} />
        <span className="floor-pointer-hint">Drag to orbit · Right-drag to pan · Scroll to zoom</span>
        <span className="floor-touch-hint">Drag to orbit · Pinch to zoom</span>
      </div>
      <div className="floor-legend">{["task", "result", "event", "failed"].map((kind) =>
        <span key={kind}><i className="p5-parcel-key" data-kind={kind} />{kind === "failed" ? "Failed result" : kind[0].toUpperCase() + kind.slice(1)}</span>)}</div>
      {hover && !selection && <div className="floor-hover-info"><strong>{stationArt[hover].label}</strong>
        <span>{summary.data?.find((entry) => entry.name === hover)?.in_progress ?? 0} in progress · {summary.data?.find((entry) => entry.name === hover)?.queue_depth ?? 0} queued</span></div>}
    </div>
    {!selection && <section className="floor-roster floor-panel" aria-label="Agents in the control room">
      <button type="button" className="floor-roster-heading" aria-expanded={rosterOpen} onClick={() => setRosterOpen(!rosterOpen)}>
        <span className="floor-tile-icon"><Icon name="agents" size={17} /></span><strong>Agents</strong><span className="floor-roster-count">{names.length + 1}</span><Icon name={rosterOpen ? "chevron-down" : "chevron-up"} size={16} />
      </button>
      {rosterOpen && <><label className="floor-search"><Icon name="search" size={15} /><span className="sr-only">Find an agent</span>
        <input type="search" value={search} placeholder="Find an agent" onChange={(event) => setSearch(event.target.value)} /></label>
        <ul className="floor-roster-list">{(["orchestrator", ...names] as MapAgent[]).filter((name) => stationArt[name].label.toLowerCase().includes(search.toLowerCase())).map((name) => {
          const stats = summary.data?.find((entry) => entry.name === name);
          return <li key={name}><button type="button" onClick={() => onStation(name)}><span><strong>{stationArt[name].label}</strong><small>{stats?.in_progress ?? 0} in progress · {stats?.queue_depth ?? 0} queued</small></span><Icon name="chevron-right" size={14} /></button></li>;
        })}</ul>
        {!["orchestrator", ...names].some((name) => stationArt[name as MapAgent].label.toLowerCase().includes(search.toLowerCase())) && <p className="floor-roster-empty">No matching agents.</p>}
      </>}
    </section>}
    <details className="agent-replay floor-panel"><summary><Icon name="history" size={16} />Order replay <Icon name="chevron-down" size={14} /></summary>
    <section aria-label="Order replay" className="p5-replay">
      <div className="p5-replay-field"><label htmlFor={orderControl}>Order replay</label>
        <Select id={orderControl} value={order} onChange={(event) => { setPlaying(false); seek(0); setOrder(event.target.value); }}>
          <option value="">Live traffic</option>
          {orders.data?.map((entry) => <option key={entry.id} value={entry.id}>{entry.order_number}</option>)}
        </Select>
      </div>
      <button className="button" type="button" disabled={!order || !plan.end} onClick={() => {
        if (!playing && position.current >= plan.end) seek(0);
        setPlaying(!playing);
      }}>{playing ? "Pause" : "Play"}</button>
      <div className="p5-replay-field"><label htmlFor={speedControl}>Speed</label>
        <Select id={speedControl} value={speed} onChange={(event) => setSpeed(event.target.value === "4" ? 4 : 1)}>
          <option value="1">1×</option><option value="4">4×</option>
        </Select>
      </div>
      <label className="p5-scrubber">Replay time
        <input key={order} ref={slider} type="range" min="0" max={plan.end || 1} step="1" defaultValue="0"
          aria-valuetext="0:00" disabled={!plan.end} onChange={(event) => seek(Number(event.target.value))} />
      </label>
      <span className="p5-replay-time"><output key={order} ref={elapsed}>0:00</output> / {clockLabel(plan.end)}</span>
    </section>
    <QueryNotice pending={orders.isPending || Boolean(order && history.isPending)} error={orders.isError || history.isError}
      retry={() => void (orders.isError ? orders.refetch() : history.refetch())} />
    {order && history.isSuccess && !plan.ordered.length && <p className="p5-notice">This order has no messages to replay.</p>}
    </details>
    {selection && <AgentDrawer key={`${selection.type}-${selection.name}`} selection={selection} live={recent}
      onLocate={() => setFocus({ ...selection })} onClose={closeInspector} />}
  </section>;
}
