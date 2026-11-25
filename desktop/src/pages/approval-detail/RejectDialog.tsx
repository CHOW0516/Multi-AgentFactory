import { useState } from "react";
import type { ApprovalDecisionIn } from "../../api/types";
import { Dialog } from "../../components/Dialog";

type RejectReason = NonNullable<ApprovalDecisionIn["reject_reason"]>;

const REASONS: { value: RejectReason; label: string; help: string }[] = [
  { value: "replan", label: "Re-plan", help: "Planning tries again with your comment." },
  { value: "counter_offer", label: "Counter-offer", help: "Sales gets a draft that proposes another date or terms." },
  { value: "decline", label: "Decline the order", help: "Sales gets a polite decline draft. Holds are released." },
];

export function RejectDialog({ open, onClose, onSubmit, busy }: {
  open: boolean; onClose: () => void; busy?: boolean;
  onSubmit: (reason: RejectReason, comment: string) => void;
}) {
  const [reason, setReason] = useState<RejectReason | null>(null);
  const [comment, setComment] = useState("");
  const [showError, setShowError] = useState(false);

  function submit() {
    if (!reason) { setShowError(true); return; }
    onSubmit(reason, comment.trim());
  }

  return (
    <Dialog open={open} title="Reject this plan" onClose={onClose} testId="reject-dialog" footer={
      <>
        <button type="button" className="button" onClick={onClose}>Cancel</button>
        <button type="button" className="button button-danger" data-testid="reject-submit" disabled={busy} onClick={submit}>
          {busy ? "Sending…" : "Reject"}
        </button>
      </>
    }>
      <fieldset className="radio-list" style={{ border: "none", padding: 0, margin: 0 }}>
        <legend className="small muted" style={{ marginBottom: 8 }}>Why?</legend>
        {REASONS.map((option) => (
          <label key={option.value}>
            <input type="radio" name="reject-reason" value={option.value} data-testid={`reject-reason-${option.value}`}
              checked={reason === option.value} onChange={() => { setReason(option.value); setShowError(false); }} />
            <span><strong>{option.label}</strong> <span className="muted small">{option.help}</span></span>
          </label>
        ))}
      </fieldset>
      {showError ? <p className="error-text" role="alert">Choose a reason.</p> : null}
      <div className="field">
        <label htmlFor="reject-comment">Comment (shared with planning and sales)</label>
        <textarea id="reject-comment" data-testid="reject-comment" value={comment} onChange={(event) => setComment(event.target.value)} />
      </div>
    </Dialog>
  );
}
