import { ApiError, registerMock } from "../../api/client";
import type { ApprovalDecisionIn } from "../../api/types";
import { approvalPackFor, approvals, customerMessageFor, findOrder } from "../../components/mock-data";

registerMock("GET", "/approvals", ({ query }) => {
  const status = query.get("status");
  return status ? approvals.filter((approval) => approval.status === status) : approvals;
});

registerMock("GET", "/approvals/:approvalId", ({ params }) => {
  const approval = approvals.find((candidate) => candidate.id === params.approvalId);
  if (!approval) throw new ApiError(404, "Approval not found");
  return approvalPackFor(approval);
});

registerMock("POST", "/approvals/:approvalId/decision", ({ params, body }) => {
  const approval = approvals.find((candidate) => candidate.id === params.approvalId);
  if (!approval) throw new ApiError(404, "Approval not found");
  if (approval.status !== "waiting") throw new ApiError(409, "This approval was already decided");
  const decision = body as ApprovalDecisionIn;
  if (decision.decision === "reject" && !decision.reject_reason) throw new ApiError(422, "A reject needs a reason");
  approval.status = "decided";
  const order = findOrder(approval.order_id);
  if (order) {
    if (decision.decision === "reject") {
      order.status = decision.reject_reason === "replan" ? "REPLAN_NEEDED" : decision.reject_reason === "decline" ? "DECLINED" : "REPLY_DRAFTED";
      if (decision.reject_reason === "counter_offer") customerMessageFor(order, "counter");
    } else if (decision.decision === "approve" || decision.decision === "choose_option") {
      order.status = "REPLY_DRAFTED";
      order.promised_date = order.due_date;
      customerMessageFor(order);
    }
  }
  return approval;
});
