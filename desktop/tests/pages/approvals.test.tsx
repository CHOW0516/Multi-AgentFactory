import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { approvalPackFor, approvals, machines } from "../../src/components/mock-data";
import { ApprovalPackView } from "../../src/pages/approval-detail/ApprovalPackView";
import { RejectDialog } from "../../src/pages/approval-detail/RejectDialog";
import { sortApprovals } from "../../src/pages/approvals/ApprovalsPage";
import { logInAs } from "./helpers";

function renderPack(approvalIndex = 0) {
  logInAs("manager");
  const handlers = { onApprove: vi.fn(), onReject: vi.fn(), onAsk: vi.fn() };
  const pack = approvalPackFor(approvals[approvalIndex]);
  render(<MemoryRouter><ApprovalPackView pack={pack} machines={machines} handlers={handlers} /></MemoryRouter>);
  return { handlers, pack };
}

describe("approval pack", () => {
  it("renders every section of the pack", () => {
    renderPack();
    for (const section of ["Original purchase order", "Extracted fields", "Quotation comparison", "Material", "Plan options", "Schedule impact", "Customer message"]) {
      expect(screen.getByRole("region", { name: section })).toBeInTheDocument();
    }
    expect(screen.getByText("Recommended")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.getByTestId("approve-button")).toBeEnabled();
  });

  it("approves the recommended option unless another is chosen", async () => {
    const { handlers, pack } = renderPack();
    const recommended = pack.plan_options.find((option) => option.is_recommended);
    await userEvent.click(screen.getByTestId("approve-button"));
    expect(handlers.onApprove).toHaveBeenCalledWith(recommended?.id);
    await userEvent.click(screen.getByRole("radio", { name: "Overtime" }));
    await userEvent.click(screen.getByTestId("approve-button"));
    expect(handlers.onApprove).toHaveBeenLastCalledWith(pack.plan_options.find((option) => option.option_type === "overtime")?.id);
  });

  it("shows what changed on a re-plan", () => {
    const replanIndex = approvals.findIndex((approval) => approval.approval_type === "replan");
    renderPack(replanIndex);
    expect(within(screen.getByTestId("approval-what-changed")).getByText(/PRS-01 is down/)).toBeInTheDocument();
  });

  it("asks the orchestrator about this order", async () => {
    const { handlers } = renderPack();
    await userEvent.click(screen.getByRole("button", { name: "Ask orchestrator" }));
    expect(handlers.onAsk).toHaveBeenCalled();
  });
});

describe("reject dialog", () => {
  it("needs a reason before it sends", async () => {
    const onSubmit = vi.fn();
    render(<RejectDialog open onClose={() => {}} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByTestId("reject-submit"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a reason");

    await userEvent.click(screen.getByTestId("reject-reason-counter_offer"));
    fireEvent.change(screen.getByTestId("reject-comment"), { target: { value: "  Offer 2 weeks later  " } });
    await userEvent.click(screen.getByTestId("reject-submit"));
    expect(onSubmit).toHaveBeenCalledWith("counter_offer", "Offer 2 weeks later");
  });
});

describe("approval inbox order", () => {
  it("sorts by due date, no date last, then by waiting time", () => {
    const base = approvals[0];
    const sorted = sortApprovals([
      { ...base, id: "late", due_date: "2026-12-20", waiting_since: "2026-11-01T00:00:00Z" },
      { ...base, id: "none", due_date: null, waiting_since: "2026-10-01T00:00:00Z" },
      { ...base, id: "soon-new", due_date: "2026-12-01", waiting_since: "2026-11-20T00:00:00Z" },
      { ...base, id: "soon-old", due_date: "2026-12-01", waiting_since: "2026-11-10T00:00:00Z" },
    ]);
    expect(sorted.map((approval) => approval.id)).toEqual(["soon-old", "soon-new", "late", "none"]);
  });
});
