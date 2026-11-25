// Everything the manager needs for one decision, on one screen.
import { useState } from "react";
import { Link } from "react-router-dom";
import type { ApprovalPack, MachineOut } from "../../api/types";
import { formatDate, formatDateTime, formatNumber, timeSince } from "../../components/format";
import { MiniGantt, type GanttBar } from "../../components/MiniGantt";
import { PdfViewer } from "../../components/PdfViewer";
import { FieldCheck } from "../order-detail/FieldCheck";
import { PlanOptionCards } from "./PlanOptionCards";
import { RejectDialog } from "./RejectDialog";

export interface DecisionHandlers {
  onApprove: (optionId: string) => void;
  onReject: (reason: "replan" | "counter_offer" | "decline", comment: string) => void;
  onAsk: () => void;
  busy?: boolean;
}

function packGantt(pack: ApprovalPack, machines: MachineOut[]) {
  const machineIds = [...new Set(pack.gantt_slots.map((slot) => slot.machine_id))];
  const lanes = machineIds.map((machineId) => ({ key: machineId, label: machines.find((machine) => machine.id === machineId)?.code ?? "Machine" }));
  const bars: GanttBar[] = pack.gantt_slots.map((slot) => ({
    id: slot.id, lane: slot.machine_id, label: slot.order_number, start: slot.start_at, end: slot.end_at,
    tone: slot.order_id === pack.order_id ? "highlight" : "moved",
  }));
  const times = pack.gantt_slots.flatMap((slot) => [new Date(slot.start_at).getTime(), new Date(slot.end_at).getTime()]);
  const from = new Date(Math.min(...times) - 12 * 3_600_000).toISOString();
  const to = new Date(Math.max(...times) + 12 * 3_600_000).toISOString();
  return { lanes, bars, from, to };
}

export function ApprovalPackView({ pack, machines, userName, handlers }: {
  pack: ApprovalPack; machines: MachineOut[]; userName?: (userId: string | null) => string | undefined; handlers: DecisionHandlers;
}) {
  const recommended = pack.plan_options.find((option) => option.is_recommended) ?? pack.plan_options[0];
  const [selectedId, setSelectedId] = useState<string | null>(recommended?.id ?? null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const waiting = pack.status === "waiting";
  const gantt = pack.gantt_slots.length > 0 ? packGantt(pack, machines) : null;

  return (
    <div className="stack" data-testid="approval-pack">
      {pack.what_changed && pack.what_changed.length > 0 ? (
        <div className="banner" data-testid="approval-what-changed" role="status">
          <strong>What changed since the last plan</strong>
          <ul>{pack.what_changed.map((change) => <li key={change}>{change}</li>)}</ul>
        </div>
      ) : null}
      {!waiting ? <div className="banner">This approval is {pack.status}. It can no longer be changed.</div> : null}

      <div className="split-view">
        <section className="card compact" aria-label="Original purchase order">
          <h2 className="section-title">Original PO</h2>
          <PdfViewer path={pack.document_url} title={`PO for ${pack.order_number}`} />
        </section>
        <section className="card compact" aria-label="Extracted fields">
          <h2 className="section-title">Extracted fields</h2>
          <FieldCheck fields={pack.fields} editable={false} userName={userName} />
        </section>
      </div>

      <div className="grid-2">
        <section className="card compact" aria-label="Quotation comparison">
          <h2 className="section-title">PO vs quotation</h2>
          {pack.quotation_comparison.length === 0 ? <p className="muted small">No quotation found for this order.</p> : (
            <table className="field-table">
              <thead><tr><th>Field</th><th>PO</th><th>Quotation</th></tr></thead>
              <tbody>
                {pack.quotation_comparison.map((row) => (
                  <tr key={row.field}>
                    <td>{row.field}</td>
                    <td className={row.matches ? undefined : "mismatch"}>{row.po_value ?? "—"}</td>
                    <td>{row.quote_value ?? "—"}{row.matches ? "" : " ⚠"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card compact" aria-label="Material">
          <h2 className="section-title">Material {pack.material.material_ready_date ? <span className="muted small">· ready {formatDate(pack.material.material_ready_date)}</span> : null}</h2>
          {pack.material.data_warnings.map((warning) => <p key={warning} className="error-text">⚠ {warning}</p>)}
          <table className="field-table">
            <thead><tr><th>Material</th><th className="align-right">Needed</th><th className="align-right">Available</th><th className="align-right">Held</th><th className="align-right">Short</th><th>Arrives</th><th>Counted</th></tr></thead>
            <tbody>
              {pack.material.needs.map((need) => (
                <tr key={need.material_id}>
                  <td data-tooltip={need.material_name}>{need.material_code}</td>
                  <td className="align-right">{formatNumber(need.needed)} {need.unit}</td>
                  <td className="align-right">{formatNumber(need.available)}</td>
                  <td className="align-right">{formatNumber(need.held)}</td>
                  <td className={`align-right${Number(need.short) > 0 ? " mismatch" : ""}`}>{formatNumber(need.short)}</td>
                  <td>{formatDate(need.arrives)}</td>
                  <td className="small muted">{need.last_counted_at ? `${timeSince(need.last_counted_at)} ago` : "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pack.material.hold_expires_at ? <p className="small muted">Temporary holds expire {formatDateTime(pack.material.hold_expires_at)}.</p> : null}
        </section>
      </div>

      <section className="card compact" aria-label="Plan options">
        <h2 className="section-title">Plan options</h2>
        <PlanOptionCards options={pack.plan_options} selectedId={selectedId} onSelect={setSelectedId} disabled={!waiting} />
      </section>

      <div className="grid-2">
        <section className="card compact" aria-label="Schedule impact">
          <h2 className="section-title">Schedule impact</h2>
          {gantt ? <MiniGantt {...gantt} ariaLabel="This order and the orders that move" /> : <p className="muted small">No slots planned.</p>}
          <div className="gantt-legend">
            <span><i className="gantt-highlight" /> This order</span>
            <span><i className="gantt-moved" /> Other orders</span>
          </div>
        </section>
        <section className="card compact" aria-label="Customer message">
          <h2 className="section-title">Draft customer message</h2>
          {pack.customer_message ? (
            <>
              <p className="small muted">{pack.customer_message.subject}</p>
              <pre className="message-preview">{pack.customer_message.draft_text}</pre>
            </>
          ) : <p className="muted small">Drafted after you decide.</p>}
        </section>
      </div>

      {waiting ? (
        <div className="decision-bar">
          <Link to={`/orders/${pack.order_id}`} className="small">Open order</Link>
          <span className="spacer" />
          <button type="button" className="button" onClick={handlers.onAsk}>Ask orchestrator</button>
          <button type="button" className="button" data-testid="reject-button" disabled={handlers.busy} onClick={() => setRejectOpen(true)}>Reject</button>
          <button type="button" className="button button-primary" data-testid="approve-button" disabled={handlers.busy || !selectedId}
            onClick={() => selectedId && handlers.onApprove(selectedId)}>Approve option</button>
        </div>
      ) : null}

      <RejectDialog open={rejectOpen} onClose={() => setRejectOpen(false)} busy={handlers.busy}
        onSubmit={(reason, comment) => { handlers.onReject(reason, comment); setRejectOpen(false); }} />
    </div>
  );
}
