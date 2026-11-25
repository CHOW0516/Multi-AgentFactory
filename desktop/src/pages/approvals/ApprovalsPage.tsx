import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../../api/client";
import type { ApprovalSummary, Page } from "../../api/types";
import { itemsOf } from "../../components/api-helpers";
import { DataTable, type Column } from "../../components/DataTable";
import { formatDate, timeSince } from "../../components/format";
import { PageHeader } from "../../components/PageHeader";

type StatusFilter = "waiting" | "decided" | "cancelled";

/** Waiting approvals first by due date (no date last), then by how long they have waited. */
export function sortApprovals(approvals: ApprovalSummary[]): ApprovalSummary[] {
  return [...approvals].sort((first, second) => {
    const firstDue = first.due_date ?? "9999-12-31";
    const secondDue = second.due_date ?? "9999-12-31";
    if (firstDue !== secondDue) return firstDue.localeCompare(secondDue);
    return first.waiting_since.localeCompare(second.waiting_since);
  });
}

export function ApprovalsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusFilter>("waiting");
  const approvalsQuery = useQuery({
    queryKey: ["approvals", status],
    queryFn: () => apiFetch<ApprovalSummary[] | Page<ApprovalSummary>>(`/approvals?status=${status}`),
  });
  const rows = sortApprovals(itemsOf(approvalsQuery.data));

  const columns: Column<ApprovalSummary>[] = [
    { key: "order", header: "Order", render: (approval) => <strong>{approval.order_number}</strong> },
    { key: "customer", header: "Customer", render: (approval) => approval.customer_name ?? "—" },
    { key: "type", header: "Type", render: (approval) => (approval.approval_type === "replan"
      ? <span className="badge badge-action">Re-plan</span> : <span className="badge">New order</span>) },
    { key: "due", header: "Due", render: (approval) => formatDate(approval.due_date) },
    { key: "waiting", header: "Waiting", render: (approval) => (
      <span className="row">
        {timeSince(approval.waiting_since)}
        {approval.reminded && approval.status === "waiting" ? <span className="badge badge-problem" data-tooltip="A reminder was sent">Reminder sent</span> : null}
      </span>
    ) },
  ];

  return (
    <div>
      <PageHeader title="Approvals" subtitle="One decision per order: approve a plan option, or reject with a reason." />
      <div className="tabs" role="tablist" aria-label="Approval status">
        {(["waiting", "decided", "cancelled"] as StatusFilter[]).map((tab) => (
          <button key={tab} type="button" role="tab" className="tab" aria-selected={status === tab} onClick={() => setStatus(tab)}>
            {tab === "waiting" ? `Waiting${status === "waiting" && approvalsQuery.data ? ` (${rows.length})` : ""}` : tab === "decided" ? "Decided" : "Cancelled"}
          </button>
        ))}
      </div>
      <DataTable columns={columns} rows={rows} rowKey={(approval) => approval.id}
        rowTestId={(approval) => `approval-row-${approval.id}`}
        rowClassName={(approval) => (approval.status === "waiting" ? "row-action" : "")}
        onRowClick={(approval) => navigate(`/approvals/${approval.id}`)}
        isLoading={approvalsQuery.isPending} error={approvalsQuery.error} onRetry={() => void approvalsQuery.refetch()}
        emptyText={status === "waiting" ? "Nothing is waiting for you." : "No approvals here."} caption="Approvals" />
    </div>
  );
}
