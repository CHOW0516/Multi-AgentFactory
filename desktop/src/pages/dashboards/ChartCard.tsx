// One dashboard chart: thin bars or 2px lines, recessive grid, hover tooltip, legend for 2+ series,
// and a table view (so no value depends on colour alone).
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import type { ChartOut } from "../../api/types";
import { fetchOrNull } from "../../components/api-helpers";
import { formatNumber } from "../../components/format";
import { ErrorState, LoadingSkeleton } from "../../components/QueryState";

export interface ChartDefinition { name: string; title: string; kind: "line" | "bar"; unit: string }

const SERIES_COLORS = ["var(--chart-series-1)", "var(--chart-series-2)", "var(--chart-series-3)"];
const axisStyle = { fontSize: 11, fill: "var(--color-text-muted)" };

/** [{label, SeriesA: 1, SeriesB: 2}, ...] from the contract's series/points shape. */
export function chartRows(chart: ChartOut): Record<string, string | number>[] {
  const rows = new Map<string, Record<string, string | number>>();
  for (const series of chart.series) {
    for (const [label, value] of series.points) {
      const row = rows.get(label) ?? { label };
      row[series.name] = value;
      rows.set(label, row);
    }
  }
  return [...rows.values()];
}

function ChartTooltip({ active, payload, label, unit }: Partial<TooltipContentProps<number, string>> & { unit: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div><strong>{label}</strong></div>
      {payload.map((entry) => (
        <div key={String(entry.dataKey)}>
          <span className="swatch" style={{ background: entry.color }} />{entry.name}: {formatNumber(entry.value as number, 1)} {unit}
        </div>
      ))}
    </div>
  );
}

export function ChartCard({ definition, range }: { definition: ChartDefinition; range: { from: string; to: string } }) {
  const [showTable, setShowTable] = useState(false);
  const chartQuery = useQuery({
    queryKey: ["dashboard", "chart", definition.name, range.from, range.to],
    queryFn: () => fetchOrNull<ChartOut>(`/dashboard/charts/${definition.name}?from=${range.from}&to=${range.to}`),
  });
  const chart = chartQuery.data;
  const rows = chart ? chartRows(chart) : [];
  const seriesNames = chart?.series.map((series) => series.name) ?? [];

  return (
    <section className="card compact chart-card" aria-label={definition.title}>
      <header>
        <h2>{definition.title}</h2>
        {rows.length > 0 ? (
          <button type="button" className="link-button small" onClick={() => setShowTable(!showTable)} aria-pressed={showTable}>
            {showTable ? "Show chart" : "Show table"}
          </button>
        ) : null}
      </header>
      {seriesNames.length > 1 ? (
        <div className="chart-legend">{seriesNames.map((name, index) => <span key={name}><i style={{ background: SERIES_COLORS[index] }} />{name}</span>)}</div>
      ) : null}
      {chartQuery.isPending ? <LoadingSkeleton rows={5} /> : null}
      {chartQuery.isError ? <ErrorState error={chartQuery.error} onRetry={() => void chartQuery.refetch()} /> : null}
      {chartQuery.isSuccess && rows.length === 0 ? <p className="empty-state">No data for this period.</p> : null}
      {rows.length > 0 && showTable ? (
        <table className="field-table">
          <thead><tr><th>{definition.kind === "bar" && definition.name === "machine_utilisation" ? "Machine" : "Period"}</th>
            {seriesNames.map((name) => <th key={name} className="align-right">{name} ({definition.unit})</th>)}</tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={String(row.label)}><td>{row.label}</td>{seriesNames.map((name) => <td key={name} className="align-right">{formatNumber(row[name] as number, 1)}</td>)}</tr>
          ))}</tbody>
        </table>
      ) : null}
      {rows.length > 0 && !showTable ? (
        <div className="chart-area">
          <ResponsiveContainer width="100%" height="100%">
            {definition.kind === "line" ? (
              <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="label" tick={axisStyle} tickLine={false} axisLine={{ stroke: "var(--chart-grid)" }} />
                <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={44} allowDecimals={definition.unit !== ""} />
                <Tooltip content={<ChartTooltip unit={definition.unit} />} cursor={{ stroke: "var(--color-text-muted)", strokeWidth: 1 }} />
                {seriesNames.map((name, index) => (
                  <Line key={name} type="monotone" dataKey={name} stroke={SERIES_COLORS[index]} strokeWidth={2}
                    dot={false} activeDot={{ r: 4, stroke: "var(--color-surface)", strokeWidth: 2 }} isAnimationActive={false} />
                ))}
              </LineChart>
            ) : (
              <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barGap={2}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="label" tick={axisStyle} tickLine={false} axisLine={{ stroke: "var(--chart-grid)" }} />
                <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={44} allowDecimals={definition.unit !== ""} />
                <Tooltip content={<ChartTooltip unit={definition.unit} />} cursor={{ fill: "var(--color-surface-muted)" }} />
                {seriesNames.map((name, index) => (
                  <Bar key={name} dataKey={name} fill={SERIES_COLORS[index]} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                ))}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      ) : null}
    </section>
  );
}
