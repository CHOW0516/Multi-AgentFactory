import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "../../api/client";
import type { KpiTile as KpiTileData } from "../../api/types";
import { addDays, todayIso } from "../../components/format";
import { DatePicker } from "../../components/DatePicker";
import { KpiTile } from "../../components/KpiTile";
import { PageHeader } from "../../components/PageHeader";
import { QueryState } from "../../components/QueryState";
import { ChartCard, type ChartDefinition } from "./ChartCard";
import { NeedsAttention } from "./NeedsAttention";
import { Icon } from "../../shell/icons";

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
const PRIMARY_KPIS = ["on_time_rate", "pending_approvals", "utilisation_today", "open_shortages"];

export function DashboardsPage() {
  const [range, setRange] = useState({ from: addDays(todayIso(), -30), to: todayIso() });
  const [diagnostics, setDiagnostics] = useState(false);
  const rangeIsValid = Boolean(range.from && range.to && range.from <= range.to);
  const kpisQuery = useQuery({
    queryKey: ["dashboard", "kpis", range.from, range.to],
    queryFn: () => apiFetch<KpiTileData[]>(`/dashboard/kpis?from=${range.from}&to=${range.to}`),
    enabled: rangeIsValid,
  });

  return (
    <div className="stack dashboard-page">
      <PageHeader title="Dashboards" subtitle="How orders, machines and agents are doing." />
      <NeedsAttention />
      <div className="filter-bar dashboard-range" role="group" aria-label="Date range">
        <div className="field"><label htmlFor="dashboard-from">From</label>
          <DatePicker id="dashboard-from" value={range.from} max={range.to} required onChange={(from) => setRange({ ...range, from })} /></div>
        <div className="field"><label htmlFor="dashboard-to">To</label>
          <DatePicker id="dashboard-to" value={range.to} min={range.from} required onChange={(to) => setRange({ ...range, to })} /></div>
        <div className="range-presets" role="group" aria-label="Reporting period">
        {PRESETS.map((preset) => (
          <button key={preset.days} type="button" className="button button-small"
            aria-pressed={range.from === addDays(todayIso(), -preset.days) && range.to === todayIso()}
            onClick={() => setRange({ from: addDays(todayIso(), -preset.days), to: todayIso() })}>{preset.label}</button>
        ))}
        </div>
      </div>
      {!rangeIsValid ? <p className="error-text">“From” must be on or before “To”.</p> : (
        <>
          <QueryState query={kpisQuery}>
            {(tiles) => {
              if (!tiles.length) return <p className="empty-state">No KPIs yet.</p>;
              const ranked = [...tiles].sort((first, second) => {
                const rank = (key: string) => PRIMARY_KPIS.includes(key) ? PRIMARY_KPIS.indexOf(key) : PRIMARY_KPIS.length;
                return rank(first.key) - rank(second.key);
              });
              return (
              <section className="dashboard-summary" aria-label="Performance at a glance">
                <div className="grid-tiles">{ranked.slice(0, 4).map((tile) => <KpiTile key={tile.key} tile={tile} />)}</div>
                {ranked.length > 4 && <details className="dashboard-extra-metrics inspector-more">
                  <summary>More operational metrics <span>{ranked.length - 4}</span></summary>
                  <div className="grid-tiles">{ranked.slice(4).map((tile) => <KpiTile key={tile.key} tile={tile} />)}</div>
                </details>}
              </section>
            ); }}
          </QueryState>
          <section className="dashboard-section" aria-labelledby="production-health">
            <header className="dashboard-section-heading"><span className="section-symbol"><Icon name="factory" size={18} /></span>
              <div><h2 id="production-health">Production & delivery</h2><p>Delivery reliability, approval speed and machine capacity.</p></div></header>
            <div className="grid-charts dashboard-primary">{CHARTS.slice(0, 3).map((definition) => <ChartCard key={definition.name} definition={definition} range={range} />)}</div>
          </section>
          <section className="dashboard-section dashboard-diagnostics" aria-labelledby="diagnostics-heading">
            <button type="button" className="dashboard-disclosure" aria-expanded={diagnostics} aria-controls="dashboard-diagnostics"
              onClick={() => setDiagnostics(!diagnostics)}>
              <span className="section-symbol"><Icon name="agents" size={18} /></span>
              <span><strong id="diagnostics-heading">Quality & workflow diagnostics</strong><small>Extraction accuracy, run time, AI cost and workflow failures</small></span>
              <span className="disclosure-count">4 reports</span><Icon name={diagnostics ? "chevron-up" : "chevron-down"} size={17} />
            </button>
            {diagnostics && <div id="dashboard-diagnostics" className="grid-charts">{CHARTS.slice(3).map((definition) => <ChartCard key={definition.name} definition={definition} range={range} />)}</div>}
          </section>
        </>
      )}
    </div>
  );
}
