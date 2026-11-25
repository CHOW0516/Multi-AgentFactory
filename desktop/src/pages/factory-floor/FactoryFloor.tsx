import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { apiFetch, useLiveEvents } from "../../api/client";
import type { FloorMachine, FloorOut, LiveEventDataMap, MachineOverview } from "../../api/types";
import { QueryNotice } from "../../figures/figure-ui";
import { useDemoEvents } from "../../figures/demo-events";
import { Icon } from "../../shell/icons";
import { useThemeStore } from "../../theme/theme-store";
import { FloorScene, type CartArrival, type FocusRequest } from "./FloorScene";
import { MachineDrawer } from "./MachineDrawer";
import { floorKey, issueDestination, overviewKey, statusNames, withMachineStatus } from "./model";
import "./factory-floor.css";

const emptyMachines: FloorOut["machines"] = [];

export function SceneMetric({ icon, label, value }: { icon: string; label: string; value: ReactNode }) {
  return <div className="floor-metric floor-panel">
    <span className="floor-tile-icon"><Icon name={icon} size={18} /></span>
    <div><dt>{label}</dt><dd>{value}</dd></div>
  </div>;
}

function MachineRoster({ machines, onInspect }: { machines: FloorMachine[]; onInspect: (id: string) => void }) {
  const [open, setOpen] = useState(() => window.matchMedia?.("(min-width: 720px)")?.matches ?? true);
  const [filter, setFilter] = useState("");
  const search = filter.trim().toLowerCase();
  const shown = machines.filter((machine) => `${machine.code} ${machine.name} ${statusNames[machine.status]}`.toLowerCase().includes(search));
  return <section className="floor-roster floor-panel" aria-label="Machines on the floor">
    <button type="button" className="floor-roster-heading" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span className="floor-tile-icon"><Icon name="factory" size={17} /></span>
      <strong>Machines</strong><span className="floor-roster-count">{machines.length}</span>
      <Icon name={open ? "chevron-down" : "chevron-up"} size={16} />
    </button>
    {open && <>
      <label className="floor-search">
        <Icon name="search" size={15} /><span className="sr-only">Find a machine</span>
        <input type="search" value={filter} placeholder="Find a machine" onChange={(event) => setFilter(event.target.value)} />
      </label>
      <ul className="floor-roster-list">
        {shown.map((machine) => <li key={machine.id}>
          <button type="button" onClick={() => onInspect(machine.id)}>
            <span><strong>{machine.code}</strong><small>{machine.name}</small></span>
            <span className="floor-status" data-status={machine.status}><i />{statusNames[machine.status]}</span>
            <Icon name="chevron-right" size={14} />
          </button>
        </li>)}
        {shown.length === 0 && <li className="floor-roster-empty">No matching machines.</li>}
      </ul>
    </>}
  </section>;
}

export function FactoryFloor() {
  const client = useQueryClient();
  const theme = useThemeStore((state) => state.theme);
  const page = useRef<HTMLElement>(null);
  const restoreFocus = useRef<HTMLElement | SVGElement | null>(null);
  const floor = useQuery({ queryKey: floorKey, queryFn: ({ signal }) => apiFetch<FloorOut>("/floor", { signal }), refetchInterval: 30_000 });
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [arrival, setArrival] = useState<CartArrival | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const machines = floor.data?.machines ?? emptyMachines;
  const highlighted = machines.find((machine) => machine.id === hover);
  const machine = machines.find((machine) => machine.id === selected);
  const running = machines.filter((entry) => entry.status === "running").length;
  const inspect = useCallback((id: string) => {
    const trigger = document.activeElement;
    if ((trigger instanceof HTMLElement || trigger instanceof SVGElement) && trigger !== document.body &&
      !trigger.closest(".floor-inspector")) restoreFocus.current = trigger;
    setSelected(id);
    setFocus({ id });
  }, []);
  const openFromRoster = (id: string) => {
    inspect(id);
    setFocus({ id });
  };
  const closeInspector = () => {
    setSelected(null);
    requestAnimationFrame(() => {
      const trigger = restoreFocus.current;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      else page.current?.querySelector<SVGSVGElement>(".floor-model")?.focus({ preventScroll: true });
      restoreFocus.current = null;
    });
  };

  useDemoEvents();
  useLiveEvents(["machine_status_changed"], (event) => {
    const change = event.data as LiveEventDataMap["machine_status_changed"];
    client.setQueryData<FloorOut>(floorKey, (previous) => withMachineStatus(previous, change.machine_id, change.status));
    client.setQueryData<MachineOverview>(overviewKey(change.machine_id), (previous) =>
      previous && { ...previous, machine: { ...previous.machine, status: change.status } });
    void client.invalidateQueries({ queryKey: floorKey });
    void client.invalidateQueries({ queryKey: overviewKey(change.machine_id) });
  });
  useLiveEvents(["approval_created", "order_state_changed"], () => { void client.invalidateQueries({ queryKey: floorKey }); });
  useLiveEvents(["agent_message"], (event) => {
    const message = event.data as LiveEventDataMap["agent_message"];
    const destination = issueDestination(message, machines);
    if (destination) setArrival({ id: message.message_id, x: destination.floor_x, y: destination.floor_y });
  });

  return <section ref={page} className="floor-workspace p5-page iso" data-theme={theme}
    data-inspecting={Boolean(machine) || undefined} onKeyDown={(event) => {
      if (event.key === "Escape" && machine) { event.stopPropagation(); closeInspector(); }
    }}>
    {floor.data && <FloorScene machines={machines} approvals={floor.data.pending_approvals} active={selected ?? hover}
      onInspect={inspect} onHover={setHover} arrival={arrival} focus={focus} inspecting={Boolean(machine)} />}
    <header className="floor-overview">
      <h1>Factory floor</h1>
      <dl className="floor-metrics">
        <SceneMetric icon="factory" label="Machines running" value={floor.data ? <>{running}<span> / {machines.length}</span></> : "—"} />
        <SceneMetric icon="orders" label="Orders in production" value={floor.data?.orders_in_production ?? "—"} />
        <SceneMetric icon="approvals" label="Pending approvals" value={floor.data?.pending_approvals ?? "—"} />
      </dl>
      <QueryNotice pending={floor.isPending} error={floor.isError} retry={() => void floor.refetch()} />
      {floor.data && machines.length === 0 && <p className="p5-notice">No machines are registered.</p>}
    </header>
    {floor.data && <div className="floor-guide floor-panel">
      <div className="floor-guide-title">
        <Icon name="orbit" size={17} />
        <span className="floor-pointer-hint">Drag to orbit <span>·</span> Right-drag to pan <span>·</span> Scroll to zoom</span>
        <span className="floor-touch-hint">Drag to orbit <span>·</span> Pinch to zoom</span>
      </div>
      <div className="floor-legend" aria-label="Machine status legend">
        {Object.entries(statusNames).map(([status, name]) => <span key={status} data-status={status}><i />{name}</span>)}
      </div>
      {highlighted && !machine && <div className="floor-hover-info">
        <strong>{highlighted.name}</strong><span>{highlighted.current_order_number ?? "No current order"} · {highlighted.part_count} parts</span>
      </div>}
    </div>}
    {machines.length > 0 && !machine && <MachineRoster machines={machines} onInspect={openFromRoster} />}
    {machine && <MachineDrawer key={machine.id} machine={machine} onLocate={() => setFocus({ id: machine.id })} onClose={closeInspector} />}
  </section>;
}
