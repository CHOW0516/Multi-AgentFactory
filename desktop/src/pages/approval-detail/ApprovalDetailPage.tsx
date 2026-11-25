import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../../api/client";
import type { ApprovalDecisionIn, ApprovalPack, MachineOut, UserOut } from "../../api/types";
import { useChatPanel } from "../../components/chat-store";
import { formatDate, timeSince } from "../../components/format";
import { PageHeader } from "../../components/PageHeader";
import { QueryState } from "../../components/QueryState";
import { ApprovalPackView } from "./ApprovalPackView";

export function ApprovalDetailPage() {
  const { approvalId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const openChat = useChatPanel((state) => state.openChat);
  const packQuery = useQuery({ queryKey: ["approvals", "pack", approvalId], queryFn: () => apiFetch<ApprovalPack>(`/approvals/${approvalId}`) });
  const machinesQuery = useQuery({ queryKey: ["machines"], queryFn: () => apiFetch<MachineOut[]>("/machines") });
  const usersQuery = useQuery({ queryKey: ["users"], queryFn: () => apiFetch<UserOut[]>("/users"), retry: false });

  const decide = useMutation({
    mutationFn: (decision: ApprovalDecisionIn) => apiFetch(`/approvals/${approvalId}/decision`, { method: "POST", body: decision }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["approvals"] });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      navigate("/approvals");
    },
  });

  return (
    <QueryState query={packQuery} rows={10}>
      {(pack) => (
        <div>
          <Link to="/approvals" className="small">← Approvals</Link>
          <PageHeader title={`${pack.approval_type === "replan" ? "Re-plan" : "Approve"} ${pack.order_number}`}
            subtitle={`${pack.customer_name ?? ""} · due ${formatDate(pack.due_date)} · waiting ${timeSince(pack.waiting_since)}`} />
          {decide.isError ? <p className="error-text" role="alert">Could not send the decision: {decide.error.message}</p> : null}
          <ApprovalPackView pack={pack} machines={machinesQuery.data ?? []}
            userName={(userId) => usersQuery.data?.find((user) => user.id === userId)?.name}
            handlers={{
              busy: decide.isPending,
              onApprove: (optionId) => decide.mutate({ decision: "approve", chosen_option_id: optionId }),
              onReject: (reason, comment) => decide.mutate({ decision: "reject", reject_reason: reason, comment: comment || null }),
              onAsk: () => openChat({ id: pack.order_id, label: pack.order_number }),
            }} />
        </div>
      )}
    </QueryState>
  );
}
