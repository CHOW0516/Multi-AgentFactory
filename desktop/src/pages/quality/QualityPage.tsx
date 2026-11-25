import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "../../api/client";
import type { OrderSummary, Page, QcCheck, QcPlanOut, QcRecordIn, QcRecordOut } from "../../api/types";
import { fetchOrNull } from "../../components/api-helpers";
import { formatDate, formatDateTime } from "../../components/format";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState, QueryState } from "../../components/QueryState";
import { OrderStatusBadge } from "../../components/StatusBadge";

/** Shape of GET /qc/orders/{id} as P4 reads it (see docs/requests/p4.md). */
export interface QcOrderOut { plan: QcPlanOut | null; records: QcRecordOut[] }

/** Checks that should have a result by now but have none. */
export function missingChecks(order: OrderSummary, qc: QcOrderOut): QcCheck[] {
  const done = new Set(qc.records.map((record) => record.check_name));
  return (qc.plan?.checks ?? []).filter((check) => !done.has(check.name)
    && (check.kind === "first_piece" || (check.kind === "final" && order.status === "COMPLETED")));
}

export function QualityPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const ordersQuery = useQuery({
    queryKey: ["orders", "qc-list"],
    queryFn: async () => {
      const [running, done] = await Promise.all([
        apiFetch<Page<OrderSummary>>("/orders?status=IN_PRODUCTION&page_size=200"),
        apiFetch<Page<OrderSummary>>("/orders?status=COMPLETED&page_size=50"),
      ]);
      return [...running.items, ...done.items];
    },
  });

  return (
    <div>
      <PageHeader title="Quality" subtitle="Checks for orders in production. Record each result as you measure." />
      <div className="split-view" style={{ gridTemplateColumns: "minmax(260px, 0.6fr) minmax(0, 1.4fr)" }}>
        <section className="card compact" aria-label="Orders needing checks">
          <h2 className="section-title">Orders</h2>
          <QueryState query={ordersQuery}>
            {(orders) => (orders.length === 0 ? <EmptyState>No orders in production.</EmptyState> : (
              <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0, gap: 4 }}>
                {orders.map((order) => (
                  <li key={order.id}>
                    <button type="button" className={`button${selectedId === order.id ? " button-primary" : ""}`} style={{ width: "100%", justifyContent: "space-between" }}
                      aria-pressed={selectedId === order.id} onClick={() => setSelectedId(order.id)}>
                      <span>{order.order_number} <span className="small">{order.customer_name}</span></span>
                      <span className="small">{formatDate(order.due_date)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ))}
          </QueryState>
        </section>
        <section className="card compact" aria-label="Checklist">
          {selectedId && ordersQuery.data ? (
            <QcChecklist order={ordersQuery.data.find((order) => order.id === selectedId) as OrderSummary} />
          ) : <EmptyState>Choose an order to see its checklist.</EmptyState>}
        </section>
      </div>
    </div>
  );
}

function QcChecklist({ order }: { order: OrderSummary }) {
  const queryClient = useQueryClient();
  const qcQuery = useQuery({ queryKey: ["qc", order.id], queryFn: () => fetchOrNull<QcOrderOut>(`/qc/orders/${order.id}`) });
  const [measured, setMeasured] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (record: QcRecordIn) => apiFetch<QcRecordOut>("/qc/records", { method: "POST", body: record }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["qc", order.id] }),
  });

  return (
    <div className="stack">
      <div className="row"><h2 className="section-title" style={{ margin: 0 }}>{order.order_number}</h2><OrderStatusBadge state={order.status} /></div>
      <QueryState query={qcQuery}>
        {(qc) => {
          if (!qc?.plan) return <EmptyState>No QC plan for this order yet.</EmptyState>;
          const missing = missingChecks(order, qc);
          return (
            <>
              {missing.length > 0 ? (
                <div className="banner banner-warning" role="alert">⚠ Missing: {missing.map((check) => check.name).join(", ")}</div>
              ) : null}
              {save.isError ? <p className="error-text" role="alert">Could not save: {save.error.message}</p> : null}
              {qc.plan.checks.map((check) => {
                const records = qc.records.filter((record) => record.check_name === check.name);
                return (
                  <div key={check.name} className="card compact" style={{ boxShadow: "none" }}>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <strong>{check.name}</strong>
                      <span className="small muted">{check.kind === "sample" ? `every ${check.every_n} pcs` : check.kind === "first_piece" ? "first piece" : "final"}</span>
                    </div>
                    {check.spec ? <p className="small muted" style={{ margin: "4px 0 8px" }}>Spec: {check.spec}</p> : null}
                    {records.map((record) => (
                      <div key={record.id} className="small">
                        <span className={record.result === "pass" ? "" : "mismatch"}>{record.result === "pass" ? "✓ Pass" : "✕ Fail"}</span>
                        {record.measured_value ? ` · ${record.measured_value}` : ""} · {formatDateTime(record.created_at)}{record.note ? ` · ${record.note}` : ""}
                      </div>
                    ))}
                    <div className="row" style={{ marginTop: 8 }}>
                      <input aria-label={`Measured value for ${check.name}`} placeholder="Measured value" className="inline-input mono"
                        value={measured[check.name] ?? ""} onChange={(event) => setMeasured({ ...measured, [check.name]: event.target.value })} />
                      <input aria-label={`Note for ${check.name}`} placeholder="Note" className="inline-input" style={{ flex: 1 }}
                        value={notes[check.name] ?? ""} onChange={(event) => setNotes({ ...notes, [check.name]: event.target.value })} />
                      {(["pass", "fail"] as const).map((result) => (
                        <button key={result} type="button" className={`button button-small${result === "fail" ? " button-danger" : ""}`} disabled={save.isPending}
                          onClick={() => save.mutate({ order_id: order.id, check_name: check.name, result,
                            measured_value: measured[check.name]?.trim() || null, note: notes[check.name]?.trim() || null })}>
                          {result === "pass" ? "Pass" : "Fail"}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
