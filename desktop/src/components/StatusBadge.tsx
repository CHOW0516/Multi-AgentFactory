import type { MachineStatus, OrderState } from "../api/types";
import { statusColor } from "../theme/theme-store";
import { stateLabel } from "./format";

const NEEDS_ACTION: OrderState[] = ["NEEDS_FIELD_CHECK", "WAITING_APPROVAL", "REPLAN_NEEDED", "REPLY_DRAFTED"];
const PROBLEM: OrderState[] = ["FAILED", "REJECTED", "DECLINED"];
const FINISHED: OrderState[] = ["COMPLETED", "CUSTOMER_REPLIED"];

export function orderTone(state: OrderState): "action" | "problem" | "done" | "neutral" {
  if (NEEDS_ACTION.includes(state)) return "action";
  if (PROBLEM.includes(state)) return "problem";
  if (FINISHED.includes(state)) return "done";
  return "neutral";
}

export function OrderStatusBadge({ state, testId }: { state: OrderState; testId?: string }) {
  return <span className={`badge badge-${orderTone(state)}`} data-testid={testId}>{stateLabel(state)}</span>;
}

export function MachineStatusBadge({ status }: { status: MachineStatus }) {
  return (
    <span className="badge badge-neutral">
      <span className="status-dot" style={{ background: statusColor(status) }} aria-hidden="true" />
      {stateLabel(status)}
    </span>
  );
}
