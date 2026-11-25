import { Select } from "../../components/Select";
// Store form for receive / issue / scrap / return / adjust. A barcode scanner works as keyboard
// input: it types the code into the material field and presses Enter, which moves to quantity.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { apiFetch } from "../../api/client";
import type { MaterialOut, MovementType } from "../../api/types";
import { MOVEMENT_LABELS, toMovementRequest, validateMovement, type MovementDraft } from "./movement-rules";

const EMPTY_DRAFT: MovementDraft = { materialCode: "", movementType: "receive", quantity: "", adjustDirection: "add", reference: "", reason: "" };

export function MovementForm({ materials, presetCode, onDone }: { materials: MaterialOut[]; presetCode?: string; onDone?: () => void }) {
  const [draft, setDraft] = useState<MovementDraft>({ ...EMPTY_DRAFT, materialCode: presetCode ?? "" });
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const quantityRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const material = materials.find((candidate) => candidate.code.toLowerCase() === draft.materialCode.trim().toLowerCase());

  const save = useMutation({
    mutationFn: () => apiFetch("/stock-movements", { method: "POST", body: toMovementRequest(draft, material as MaterialOut) }),
    onSuccess: () => {
      setSavedMessage(`Saved: ${MOVEMENT_LABELS[draft.movementType]} ${draft.quantity} ${material?.unit ?? ""} of ${material?.code ?? ""}.`);
      setDraft({ ...EMPTY_DRAFT, movementType: draft.movementType, materialCode: presetCode ?? "" });
      void queryClient.invalidateQueries({ queryKey: ["materials"] });
      void queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
      onDone?.();
    },
  });

  function update(change: Partial<MovementDraft>) {
    setDraft((current) => ({ ...current, ...change }));
    setSavedMessage(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const found = validateMovement(draft, materials);
    setProblems(found);
    if (Object.keys(found).length === 0) save.mutate();
  }

  return (
    <form onSubmit={submit} aria-label="Stock movement" noValidate>
      <div className="field">
        <label htmlFor="movement-material">Material code</label>
        <input id="movement-material" list="material-codes" value={draft.materialCode} autoComplete="off"
          readOnly={Boolean(presetCode)} aria-invalid={Boolean(problems.materialCode)}
          onChange={(event) => update({ materialCode: event.target.value })}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); quantityRef.current?.focus(); } }} />
        <datalist id="material-codes">{materials.map((candidate) => <option key={candidate.id} value={candidate.code}>{candidate.name}</option>)}</datalist>
        {material ? <span className="small muted">{material.name} · {material.stock} {material.unit} in stock</span> : null}
        {problems.materialCode ? <span className="error-text">{problems.materialCode}</span> : null}
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="movement-type">Type</label>
          <Select id="movement-type" value={draft.movementType} onChange={(event) => update({ movementType: event.target.value as MovementType })}>
            {(Object.keys(MOVEMENT_LABELS) as MovementType[]).map((type) => <option key={type} value={type}>{MOVEMENT_LABELS[type]}</option>)}
          </Select>
        </div>
        <div className="field">
          <label htmlFor="movement-quantity">Quantity{material ? ` (${material.unit})` : ""}</label>
          <input id="movement-quantity" ref={quantityRef} inputMode="decimal" value={draft.quantity} aria-invalid={Boolean(problems.quantity)}
            onChange={(event) => update({ quantity: event.target.value })} />
          {problems.quantity ? <span className="error-text">{problems.quantity}</span> : null}
        </div>
      </div>
      {draft.movementType === "adjust" ? (
        <div className="radio-list" role="radiogroup" aria-label="Adjust direction">
          <label><input type="radio" checked={draft.adjustDirection === "add"} onChange={() => update({ adjustDirection: "add" })} /> Add to stock</label>
          <label><input type="radio" checked={draft.adjustDirection === "remove"} onChange={() => update({ adjustDirection: "remove" })} /> Remove from stock</label>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="movement-reference">Reference (delivery note, order number)</label>
        <input id="movement-reference" value={draft.reference} onChange={(event) => update({ reference: event.target.value })} />
        {problems.reference ? <span className="error-text">{problems.reference}</span> : null}
      </div>
      <div className="field">
        <label htmlFor="movement-reason">Reason</label>
        <input id="movement-reason" value={draft.reason} onChange={(event) => update({ reason: event.target.value })}
          placeholder="Needed for scrap and adjustments. For a paper slip: “Paper slip, happened <date>”" />
        {problems.reason ? <span className="error-text">{problems.reason}</span> : null}
      </div>
      {save.isError ? <p className="error-text" role="alert">Could not save: {save.error.message}</p> : null}
      {savedMessage ? <p className="small" role="status">✓ {savedMessage}</p> : null}
      <button type="submit" className="button button-primary" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save movement"}</button>
    </form>
  );
}
