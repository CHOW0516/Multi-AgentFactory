import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../../api/client";
import type {
  CustomerMessageOut, ExtractedFieldOut, FieldCorrection, OrderDetail, PlanOptionOut, TimelineEntry, UserOut,
} from "../../api/types";
import { fetchOrNull, itemsOf } from "../../components/api-helpers";
import { useChatPanel } from "../../components/chat-store";
import { formatDate, formatDateTime, formatNumber, nameLabel } from "../../components/format";
import { Money } from "../../components/Money";
import { PageHeader } from "../../components/PageHeader";
import { PdfViewer } from "../../components/PdfViewer";
import { QueryState } from "../../components/QueryState";
import { useCanSeePrices, useHasRole } from "../../components/roles";
import { OrderStatusBadge } from "../../components/StatusBadge";
import { FieldCheck } from "./FieldCheck";
import { OrderActions } from "./OrderActions";
import { Timeline } from "./Timeline";

export function OrderDetailPage() {
  const { orderId = "" } = useParams();
  const queryClient = useQueryClient();
  const openChat = useChatPanel((state) => state.openChat);
  const canCheckFields = useHasRole("sales", "manager");
  const canMarkSent = useHasRole("sales");
  const canSeePrices = useCanSeePrices();

  const orderQuery = useQuery({ queryKey: ["orders", orderId], queryFn: () => apiFetch<OrderDetail>(`/orders/${orderId}`) });
  const fieldsQuery = useQuery({ queryKey: ["orders", orderId, "fields"], queryFn: () => apiFetch<ExtractedFieldOut[]>(`/orders/${orderId}/fields`) });
  const timelineQuery = useQuery({ queryKey: ["orders", orderId, "timeline"], queryFn: () => apiFetch<TimelineEntry[]>(`/orders/${orderId}/timeline`) });
  const planQuery = useQuery({ queryKey: ["orders", orderId, "plan-options"], queryFn: () => fetchOrNull<PlanOptionOut[]>(`/orders/${orderId}/plan-options`) });
  const messageQuery = useQuery({ queryKey: ["orders", orderId, "customer-message"], queryFn: () => fetchOrNull<CustomerMessageOut>(`/orders/${orderId}/customer-message`) });
  const usersQuery = useQuery({ queryKey: ["users"], queryFn: () => apiFetch<UserOut[]>("/users"), enabled: canCheckFields, retry: false });

  const refreshOrder = () => queryClient.invalidateQueries({ queryKey: ["orders", orderId] });

  const confirmFields = useMutation({
    mutationFn: async (corrections: FieldCorrection[]) => {
      if (corrections.length > 0) await apiFetch(`/orders/${orderId}/fields`, { method: "PATCH", body: corrections });
      await apiFetch(`/orders/${orderId}/fields/confirm`, { method: "POST" });
    },
    onSuccess: () => { void refreshOrder(); void queryClient.invalidateQueries({ queryKey: ["orders"] }); },
  });
  const markSent = useMutation({
    mutationFn: () => apiFetch(`/orders/${orderId}/customer-message/sent`, { method: "POST" }),
    onSuccess: () => { void refreshOrder(); void queryClient.invalidateQueries({ queryKey: ["orders"] }); },
  });

  const userName = (userId: string | null) => itemsOf(usersQuery.data).find((user) => user.id === userId)?.name;

  return (
    <QueryState query={orderQuery} rows={8}>
      {(order) => {
        const needsFieldCheck = order.status === "NEEDS_FIELD_CHECK";
        const message = messageQuery.data;
        const chosenPlan = planQuery.data?.find((option) => option.status === "chosen" || option.status === "locked")
          ?? planQuery.data?.find((option) => option.is_recommended);
        return (
          <div className="stack">
            <Link to="/orders" className="small">← Orders</Link>
            <PageHeader title={order.order_number}
              subtitle={<>{order.customer_name} · PO {order.po_number ?? "—"} · due {formatDate(order.due_date)}{order.promised_date ? ` · promised ${formatDate(order.promised_date)}` : ""}</>}
              actions={<>
                <OrderStatusBadge state={order.status} testId="order-status" />
                <OrderActions order={order} />
                <button type="button" className="button" onClick={() => openChat({ id: order.id, label: order.order_number })}>Ask orchestrator</button>
              </>} />

            {confirmFields.isError ? <p className="error-text" role="alert">Could not save the field check: {String(confirmFields.error.message)}</p> : null}

            <div className="split-view">
              <section className="card compact" aria-label="Purchase order document">
                <h2 className="section-title">Purchase order</h2>
                <PdfViewer path={order.source_document_id ? `/orders/${order.id}/document` : null} title={`PO ${order.po_number ?? ""}`} />
              </section>
              <section className="card compact" aria-label={needsFieldCheck ? "Field check" : "Extracted fields"}>
                <h2 className="section-title">{needsFieldCheck ? "Field check" : "Extracted fields"}</h2>
                <QueryState query={fieldsQuery}>
                  {(fields) => (
                    <FieldCheck fields={fields} editable={needsFieldCheck && canCheckFields} saving={confirmFields.isPending}
                      onConfirm={(corrections) => confirmFields.mutate(corrections)} userName={userName} />
                  )}
                </QueryState>
              </section>
            </div>

            <section className="card compact" aria-label="Order lines">
              <h2 className="section-title">Lines</h2>
              <table className="field-table">
                <thead><tr><th>#</th><th>Part</th><th>Rev</th><th className="align-right">Quantity</th>{canSeePrices ? <th className="align-right">Unit price</th> : null}</tr></thead>
                <tbody>
                  {order.lines.map((line) => (
                    <tr key={line.id}>
                      <td>{line.line_number}</td><td>{line.part_number_text ?? "—"}</td><td>{line.revision_text ?? "—"}</td>
                      <td className="align-right">{formatNumber(line.quantity)}</td>
                      {canSeePrices ? <td className="align-right"><Money value={line.unit_price} /></td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <div className="grid-2">
              <section className="card compact" aria-label="Plan">
                <h2 className="section-title">Plan</h2>
                {chosenPlan ? (
                  <dl className="small">
                    <dt className="muted">Option</dt><dd>{nameLabel(chosenPlan.option_type)}</dd>
                    <dt className="muted">Finish</dt><dd>{formatDate(chosenPlan.finish_date)}</dd>
                    {Number(chosenPlan.overtime_hours) > 0 ? <><dt className="muted">Overtime</dt><dd>{chosenPlan.overtime_hours} h</dd></> : null}
                    {chosenPlan.explanation ? <><dt className="muted">Why</dt><dd>{chosenPlan.explanation}</dd></> : null}
                  </dl>
                ) : <p className="muted small">No plan yet.</p>}
              </section>
              <section className="card compact" aria-label="Customer reply">
                <h2 className="section-title">Customer reply</h2>
                {message ? (
                  <>
                    <p className="small muted">{message.subject} · {message.status === "sent_by_sales" ? `sent ${formatDateTime(message.sent_at)}` : "draft"}</p>
                    <pre className="message-preview" data-testid="customer-reply-draft">{message.draft_text}</pre>
                    {canMarkSent && message.status === "draft" ? (
                      <div className="dialog-footer">
                        <button type="button" className="button button-primary" disabled={markSent.isPending} onClick={() => markSent.mutate()}>
                          Mark as sent
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : <p className="muted small">No reply drafted yet.</p>}
              </section>
            </div>

            <section className="card compact" aria-label="Timeline">
              <h2 className="section-title">Timeline</h2>
              <QueryState query={timelineQuery}>{(entries) => <Timeline entries={entries} />}</QueryState>
            </section>
          </div>
        );
      }}
    </QueryState>
  );
}
