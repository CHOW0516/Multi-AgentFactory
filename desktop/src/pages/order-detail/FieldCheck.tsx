// Extracted PO fields. In field-check mode only flagged fields can be edited.
import { useState } from "react";
import type { ExtractedFieldOut, FieldCorrection } from "../../api/types";
import { formatNumber, nameLabel } from "../../components/format";

const LOW_CONFIDENCE = 0.85;
const FIELD_LABELS: Record<string, string> = {
  po_number: "PO number", part_number: "Part number", unit_price: "Unit price", due_date: "Due date",
  delivery_address: "Delivery address", po_revision: "PO revision",
};
const fieldLabel = (fieldName: string) => FIELD_LABELS[fieldName] ?? nameLabel(fieldName);

export function FieldCheck({ fields, editable, saving, onConfirm, userName }: {
  fields: ExtractedFieldOut[];
  editable: boolean;
  saving?: boolean;
  onConfirm?: (corrections: FieldCorrection[]) => void;
  userName?: (userId: string | null) => string | undefined;
}) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const flaggedCount = fields.filter((field) => field.needs_check).length;

  function confirm() {
    const corrections = Object.entries(edits)
      .filter(([fieldId, value]) => value !== (fields.find((field) => field.id === fieldId)?.value ?? ""))
      .map(([fieldId, value]) => ({ field_id: fieldId, corrected_value: value }));
    onConfirm?.(corrections);
  }

  return (
    <div>
      {editable && flaggedCount > 0 ? (
        <div className="banner">{flaggedCount} field{flaggedCount === 1 ? "" : "s"} need a check. Compare with the PO and correct if needed.</div>
      ) : null}
      <table className="field-table">
        <thead><tr><th>Field</th><th>Value</th><th>Confidence</th></tr></thead>
        <tbody>
          {fields.map((field) => {
            const confidence = Number(field.confidence);
            const shownValue = field.corrected_value ?? field.value ?? "";
            return (
              <tr key={field.id} className={field.needs_check ? "flagged" : undefined}>
                <td>
                  {fieldLabel(field.field_name)}
                  {field.check_reason ? <div className="corrected-note">{field.check_reason}</div> : null}
                </td>
                <td>
                  {editable && field.needs_check ? (
                    <input aria-label={fieldLabel(field.field_name)} value={edits[field.id] ?? shownValue}
                      onChange={(event) => setEdits({ ...edits, [field.id]: event.target.value })} />
                  ) : (
                    <span data-field={field.field_name}>{shownValue || "—"}</span>
                  )}
                  {field.corrected_by ? (
                    <div className="corrected-note">Corrected by {userName?.(field.corrected_by) ?? "a user"} (was “{field.value ?? "—"}”)</div>
                  ) : null}
                </td>
                <td className={confidence < LOW_CONFIDENCE ? "confidence-low" : undefined}>{formatNumber(confidence * 100)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {editable ? (
        <div className="dialog-footer">
          <button type="button" className="button button-primary" data-testid="field-check-confirm" disabled={saving} onClick={confirm}>
            {saving ? "Saving…" : "Confirm fields"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
