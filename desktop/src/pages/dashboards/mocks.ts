import { ApiError, registerMock } from "../../api/client";
import type { ChartOut, KpiTile } from "../../api/types";
import { machines } from "../../components/mock-data";

const weeks = ["W40", "W41", "W42", "W43", "W44", "W45", "W46", "W47"];
const days = Array.from({ length: 14 }, (_unused, index) => {
  const date = new Date(Date.now() - (13 - index) * 86_400_000);
  return `${date.getDate()}/${date.getMonth() + 1}`;
});

const CHARTS: Record<string, ChartOut> = {
  on_time_delivery: { name: "on_time_delivery", series: [{ name: "On time", points: weeks.map((week, index) => [week, [82, 85, 79, 88, 91, 87, 93, 94][index]]) }] },
  po_to_approval_hours: { name: "po_to_approval_hours", series: [{ name: "Hours", points: weeks.map((week, index) => [week, [30, 26, 22, 14, 9, 7.5, 6, 5.2][index]]) }] },
  machine_utilisation: { name: "machine_utilisation", series: [{ name: "Utilisation", points: machines.map((machine, index) => [machine.code, [86, 78, 41, 72, 55, 18, 34, 22][index]]) }] },
  extraction_accuracy: { name: "extraction_accuracy", series: [{ name: "Not corrected", points: weeks.map((week, index) => [week, [88, 90, 91, 93, 92, 95, 96, 96][index]]) }] },
  planned_vs_actual: { name: "planned_vs_actual", series: [
    { name: "Planned", points: machines.slice(0, 6).map((machine, index) => [machine.code, [62, 58, 30, 55, 40, 12][index]]) },
    { name: "Actual", points: machines.slice(0, 6).map((machine, index) => [machine.code, [66, 57, 33, 61, 38, 21][index]]) },
  ] },
  llm_cost_daily: { name: "llm_cost_daily", series: [{ name: "Cost", points: days.map((day, index) => [day, Number((2.1 + Math.sin(index) * 0.8 + index * 0.05).toFixed(2))]) }] },
  failed_workflows: { name: "failed_workflows", series: [{ name: "Failed", points: days.map((day, index) => [day, [0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 1][index]]) }] },
};

const KPIS: KpiTile[] = [
  { key: "on_time_rate", label: "On-time delivery", value: 93.4, unit: "%", trend: 2.1 },
  { key: "po_to_approval", label: "PO to approval (average)", value: 5.2, unit: "h", trend: -1.8 },
  { key: "pending_approvals", label: "Waiting approvals", value: 2, unit: null, trend: null },
  { key: "oldest_waiting", label: "Oldest waiting", value: 23, unit: "h", trend: null },
  { key: "utilisation_today", label: "Utilisation today", value: 51, unit: "%", trend: 4 },
  { key: "open_shortages", label: "Materials short", value: 3, unit: null, trend: null },
  { key: "open_purchase_requests", label: "Open purchase requests", value: 2, unit: null, trend: null },
  { key: "extraction_accuracy", label: "Fields right first time", value: 96, unit: "%", trend: 0.4 },
  { key: "llm_cost_per_order", label: "AI cost per order", value: 0.42, unit: "USD", trend: -0.05 },
  { key: "failed_workflows", label: "Failed workflows (period)", value: 5, unit: null, trend: null },
];

registerMock("GET", "/dashboard/kpis", () => KPIS);
registerMock("GET", "/dashboard/charts/:chartName", ({ params }) => {
  const chart = CHARTS[params.chartName];
  if (!chart) throw new ApiError(404, "Unknown chart");
  return chart;
});
