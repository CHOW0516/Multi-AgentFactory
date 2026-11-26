// Order actions that depend on the order's state: release an unknown sender's PO, record the
// customer's answer to a counter-offer, retry a failed step, or cancel the order.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "../../api/client";
import type { OrderDetail } from "../../api/types";
import { Dialog } from "../../components/Dialog";
import { useHasRole } from "../../components/roles";

const CLOSED = ["COMPLETED", "REJECTED", "DECLINED", "CANCELLED"];

export function OrderActions({ order }: { order: OrderDetail }) {
  const queryClient = useQueryClient();
  const isSales = useHasRole("sales");
  const isManager = useHasRole("manager");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");

  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      apiFetch(`/orders/${order.id}/${path}`, { method: "POST", body }),
    onSuccess: () => {
      setCancelOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  const canCancel = (isManager || (isSales && order.status !== "IN_PRODUCTION")) && !CLOSED.includes(order.status);
  return (
    <>
      {order.status === "SENDER_REVIEW" && isSales ? (
        <button type="button" className="button button-primary" data-testid="release-intake"
          disabled={action.isPending} onClick={() => action.mutate({ path: "release-intake" })}>
          Sender checked, read this PO
        </button>
      ) : null}
      {order.status === "WAITING_CUSTOMER" && isSales ? (
        <>
          <button type="button" className="button button-primary" data-testid="customer-accepted"
            disabled={action.isPending} onClick={() => action.mutate({ path: "customer-answer", body: { accepted: true } })}>
            Customer accepted
          </button>
          <button type="button" className="button" data-testid="customer-rejected"
            disabled={action.isPending} onClick={() => action.mutate({ path: "customer-answer", body: { accepted: false } })}>
            Customer rejected
          </button>
        </>
      ) : null}
      {order.status === "FAILED" && isManager ? (
        <button type="button" className="button" data-testid="retry-order"
          disabled={action.isPending} onClick={() => action.mutate({ path: "retry" })}>
          Retry failed step
        </button>
      ) : null}
      {canCancel ? (
        <button type="button" className="button button-danger" data-testid="cancel-order" onClick={() => setCancelOpen(true)}>
          Cancel order
        </button>
      ) : null}
      {action.isError ? <span className="error-text" role="alert">{String(action.error.message)}</span> : null}
      <Dialog open={cancelOpen} title="Cancel this order" onClose={() => setCancelOpen(false)} testId="cancel-dialog" footer={
        <>
          <button type="button" className="button" onClick={() => setCancelOpen(false)}>Keep order</button>
          <button type="button" className="button button-danger" data-testid="cancel-submit"
            disabled={action.isPending || !reason.trim()}
            onClick={() => action.mutate({ path: "cancel", body: { reason: reason.trim() } })}>
            Cancel order
          </button>
        </>
      }>
        <p className="small muted">Stock holds, machine time and draft purchase requests for this order are released.</p>
        <label className="small">Reason
          <textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
        </label>
      </Dialog>
    </>
  );
}
