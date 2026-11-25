import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "../../api/client";
import type { KpiTile as KpiTileData } from "../../api/types";
import { addDays, todayIso } from "../../components/format";
import { KpiTile } from "../../components/KpiTile";
import { PageHeader } from "../../components/PageHeader";
import { QueryState } from "../../components/QueryState";
import { ChartCard, type ChartDefinition } from "./ChartCard";

// Chart names agreed with P3 (see docs/requests/p4.md). A chart the backend lacks shows "No data".
export const CHARTS: ChartDefinition[] = [
  { name: "on_time_delivery", title: "On-time delivery (weekly)", kind: "line", unit: "%" },
  { name: "po_to_approval_hours", title: "PO received to approved", kind: "line", unit: "h" },
  { name: "machine_utilisation", title: "Machine utilisation", kind: "bar", unit: "%" },
  { name: "extraction_accuracy", title: "PO fields not corrected by people", kind: "line", unit: "%" },
  { name: "planned_vs_actual", title: "Planned vs actual run time", kind: "bar", unit: "h" },
  { name: "llm_cost_daily", title: "AI cost per day", kind: "bar", unit: "USD" },
  { name: "failed_workflows", title: "Failed workflows and dead letters", kind: "bar", unit: "" },
];

const PRESETS = [{ days: 7, label: "7 days" }, { days: 30, label: "30 days" }, { days: 90, label: "90 days" }];

export function DashboardsPage() {
  const [range, setRange] = useState({ from: addDays(todayIso(), -30), to: todayIso() });
  const kpisQuery = useQuery({
    queryKey: ["dashboard", "kpis", range.from, range.to],
    queryFn: () => apiFetch<KpiTileData[]>(`/dashboard/kpis?from=${range.from}&to=${range.to}`),
  });
  const rangeIsValid = range.from <= range.to;

  return (
    <div className="stack">
      <PageHeader title="Dashboards" subtitle="How orders, machines and agents are doing." />
      <div className="filter-bar" role="group" aria-label="Date range">
        <div className="field"><label htmlFor="dashboard-from">From</label>
          <input id="dashboard-from" type="date" value={range.from} max={range.to} onChange={(event) => setRange({ ...range, from: event.target.value })} /></div>
        <div className="field"><label htmlFor="dashboard-to">To</label>
          <input id="dashboard-to" type="date" value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} /></div>
        {PRESETS.map((preset) => (
          <button key={preset.days} type="button" className="button button-small"
            aria-pressed={range.from === addDays(todayIso(), -preset.days) && range.to === todayIso()}
            onClick={() => setRange({ from: addDays(todayIso(), -preset.days), to: todayIso() })}>{preset.label}</button>
        ))}
      </div>
      {!rangeIsValid ? <p className="error-text">“From” must be on or before “To”.</p> : (
        <>
          <QueryState query={kpisQuery}>
            {(tiles) => (tiles.length === 0 ? <p className="empty-state">No KPIs yet.</p> : (
              <div className="grid-tiles">{tiles.map((tile) => <KpiTile key={tile.key} tile={tile} />)}</div>
            ))}
          </QueryState>
          <div className="grid-charts">{CHARTS.map((definition) => <ChartCard key={definition.name} definition={definition} range={range} />)}</div>
        </>
      )}
    </div>
  );
}
