import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { USE_MOCKS, apiFetch, fileUrl } from "../../api/client";
import type { AuditEntryOut, Page, UserOut } from "../../api/types";
import { itemsOf } from "../../components/api-helpers";
import { formatDateTime } from "../../components/format";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState, ErrorState, LoadingSkeleton } from "../../components/QueryState";

interface HistoryFilters { actor: string; entity: string; from: string; to: string; text: string }

export function historyQueryString(filters: HistoryFilters, page: number): string {
  const query = new URLSearchParams({ page: String(page), page_size: "50" });
  if (filters.actor.trim()) query.set("actor", filters.actor.trim());
  if (filters.entity) query.set("entity", filters.entity);
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);
  if (filters.text.trim()) query.set("q", filters.text.trim());
  return query.toString();
}

/** Keys whose value differs between before and after. */
export function changedKeys(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys].filter((key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]));
}

function toCsv(entries: AuditEntryOut[]): string {
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const header = ["time", "who", "action", "entity", "entity_id", "before", "after"];
  const lines = entries.map((entry) => [entry.created_at, entry.agent ?? entry.user_id, entry.action, entry.entity, entry.entity_id,
    JSON.stringify(entry.before), JSON.stringify(entry.after)].map(quote).join(","));
  return [header.join(","), ...lines].join("\n");
}

function DiffView({ entry }: { entry: AuditEntryOut }) {
  const changed = new Set(changedKeys(entry.before, entry.after));
  const render = (values: Record<string, unknown> | null) => (values ? Object.entries(values).map(([key, value]) => (
    <div key={key} className={changed.has(key) ? "changed" : undefined}>{key}: {JSON.stringify(value)}</div>
  )) : <span className="muted">—</span>);
  return (
    <div className="diff">
      <div><div className="small muted">Before</div><pre>{render(entry.before)}</pre></div>
      <div><div className="small muted">After</div><pre>{render(entry.after)}</pre></div>
    </div>
  );
}

export function HistoryPage() {
  const [filters, setFilters] = useState<HistoryFilters>({ actor: "", entity: "", from: "", to: "", text: "" });
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const queryString = historyQueryString(filters, page);
  const historyQuery = useQuery({ queryKey: ["history", queryString], queryFn: () => apiFetch<Page<AuditEntryOut>>(`/history?${queryString}`) });
  const usersQuery = useQuery({ queryKey: ["users"], queryFn: () => apiFetch<UserOut[]>("/users"), retry: false });
  const userName = (userId: string | null) => usersQuery.data?.find((user) => user.id === userId)?.name ?? "Person";
  const entries = itemsOf(historyQuery.data);
  const total = historyQuery.data?.total ?? 0;
  const update = (change: Partial<HistoryFilters>) => { setFilters((current) => ({ ...current, ...change })); setPage(1); };

  function exportCsv() {
    if (!USE_MOCKS) { window.open(fileUrl(`/history/export.csv?${historyQueryString(filters, 1)}`), "_blank"); return; }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([toCsv(entries)], { type: "text/csv" }));
    link.download = "history.csv";
    link.click();
  }

  return (
    <div>
      <PageHeader title="History" subtitle="Every action by people and agents, with before and after values."
        actions={<button type="button" className="button" onClick={exportCsv} disabled={entries.length === 0}>Export CSV</button>} />
      <div className="filter-bar" role="search">
        <div className="field"><label htmlFor="history-text">Text</label>
          <input id="history-text" placeholder="Order number, value…" value={filters.text} onChange={(event) => update({ text: event.target.value })} /></div>
        <div className="field"><label htmlFor="history-actor">User or agent</label>
          <input id="history-actor" placeholder="e.g. planning" value={filters.actor} onChange={(event) => update({ actor: event.target.value })} /></div>
        <div className="field"><label htmlFor="history-entity">Record type</label>
          <Select id="history-entity" value={filters.entity} onChange={(event) => update({ entity: event.target.value })}>
            <option value="">All</option>{["order", "approval", "material", "quotation", "machine", "user", "setting"].map((entity) => <option key={entity} value={entity}>{entity}</option>)}
          </Select></div>
        <div className="field"><label htmlFor="history-from">From</label>
          <DatePicker id="history-from" value={filters.from} max={filters.to || undefined} onChange={(from) => update({ from })} /></div>
        <div className="field"><label htmlFor="history-to">To</label>
          <DatePicker id="history-to" value={filters.to} min={filters.from || undefined} onChange={(to) => update({ to })} /></div>
      </div>
      {historyQuery.isPending ? <LoadingSkeleton rows={8} /> : historyQuery.isError ? <ErrorState error={historyQuery.error} onRetry={() => void historyQuery.refetch()} />
        : entries.length === 0 ? <EmptyState>Nothing matches these filters.</EmptyState> : (
          <div className="table-wrap">
            <table className="data-table">
              <caption className="visually-hidden">Audit log</caption>
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th /></tr></thead>
              <tbody>
                {entries.map((entry) => (
                  <Fragment key={entry.id}>
                    <tr>
                      <td>{formatDateTime(entry.created_at)}</td>
                      <td>{entry.agent ? <span className="badge">{entry.agent} agent</span> : entry.user_id ? userName(entry.user_id) : "System"}</td>
                      <td>{entry.action}</td>
                      <td>{entry.entity}{entry.entity_id ? <span className="muted small mono"> {entry.entity_id.slice(0, 8)}</span> : null}</td>
                      <td className="align-right">
                        {entry.before || entry.after ? (
                          <button type="button" className="link-button small" aria-expanded={expanded === entry.id}
                            onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}>{expanded === entry.id ? "Hide" : "Changes"}</button>
                        ) : null}
                      </td>
                    </tr>
                    {expanded === entry.id ? <tr><td colSpan={5}><DiffView entry={entry} /></td></tr> : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {total > 50 ? (
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button type="button" className="button button-small" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="small muted">Page {page} of {Math.ceil(total / 50)}</span>
          <button type="button" className="button button-small" disabled={page * 50 >= total} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      ) : null}
    </div>
  );
}
