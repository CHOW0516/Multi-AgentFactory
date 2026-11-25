// Validation and sign rules for stock movements (store forms).
import type { MaterialOut, MovementType, StockMovementIn } from "../../api/types";

export interface MovementDraft {
  materialCode: string;
  movementType: MovementType;
  quantity: string;
  adjustDirection: "add" | "remove";
  reference: string;
  reason: string;
}

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  receive: "Receive (goods in)", issue: "Issue to production", scrap: "Scrap", return: "Return to stock", adjust: "Adjust (count difference)",
};

/** Field name -> problem. Empty object means the draft is valid. */
export function validateMovement(draft: MovementDraft, materials: MaterialOut[]): Record<string, string> {
  const problems: Record<string, string> = {};
  const material = materials.find((candidate) => candidate.code.toLowerCase() === draft.materialCode.trim().toLowerCase());
  if (!draft.materialCode.trim()) problems.materialCode = "Scan or type a material code.";
  else if (!material) problems.materialCode = "No material with this code.";
  const quantity = Number(draft.quantity);
  if (!draft.quantity.trim() || Number.isNaN(quantity)) problems.quantity = "Enter a number.";
  else if (quantity <= 0) problems.quantity = "Quantity must be more than 0.";
  else if (material && (draft.movementType === "issue" || draft.movementType === "scrap" || (draft.movementType === "adjust" && draft.adjustDirection === "remove"))
    && quantity > Number(material.stock)) problems.quantity = `Only ${material.stock} ${material.unit} in stock.`;
  if ((draft.movementType === "scrap" || draft.movementType === "adjust") && !draft.reason.trim()) problems.reason = "A reason is needed for scrap and adjustments.";
  if (draft.movementType === "receive" && !draft.reference.trim()) problems.reference = "Enter the delivery note or GRN number.";
  return problems;
}

/** Stock goes up for receive/return/adjust-add and down for issue/scrap/adjust-remove. */
export function signedQuantity(draft: MovementDraft): number {
  const quantity = Math.abs(Number(draft.quantity));
  const removes = draft.movementType === "issue" || draft.movementType === "scrap" || (draft.movementType === "adjust" && draft.adjustDirection === "remove");
  return removes ? -quantity : quantity;
}

export function toMovementRequest(draft: MovementDraft, material: MaterialOut): StockMovementIn {
  return {
    material_id: material.id, movement_type: draft.movementType, quantity: signedQuantity(draft),
    reference: draft.reference.trim() || null, reason: draft.reason.trim() || null,
  };
}
