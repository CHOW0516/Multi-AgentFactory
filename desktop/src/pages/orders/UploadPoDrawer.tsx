// Upload a PO file by drag and drop, file picker, or the desktop file dialog.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../../api/client";
import type { OrderSummary } from "../../api/types";
import { Drawer } from "../../components/Dialog";
import { desktop, isElectron } from "../../shell/desktop-bridge";

const ACCEPTED_TYPES = ".pdf,.png,.jpg,.jpeg,.tif,.tiff";
const MAX_BYTES = 20 * 1024 * 1024;

export function UploadPoDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const upload = useMutation({
    mutationFn: (chosen: File) => {
      const form = new FormData();
      form.append("file", chosen, chosen.name);
      return apiFetch<OrderSummary>("/orders/upload", { method: "POST", body: form });
    },
    onSuccess: (order) => {
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      setFile(null);
      onClose();
      if (order?.id) navigate(`/orders/${order.id}`);
    },
    onError: (caught) => setError(caught instanceof Error ? caught.message : "Upload failed"),
  });

  function choose(candidate: File | null) {
    setError(null);
    if (!candidate) return;
    if (candidate.size > MAX_BYTES) { setError("The file is larger than 20 MB."); return; }
    if (!/\.(pdf|png|jpe?g|tiff?)$/i.test(candidate.name)) { setError("Use a PDF or an image (PNG, JPG, TIFF)."); return; }
    setFile(candidate);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files[0] ?? null);
  }

  async function pickWithDesktopDialog() {
    const picked = await desktop.openFile();
    if (picked) choose(new File([picked.data], picked.name));
  }

  return (
    <Drawer open={open} title="Upload a purchase order" onClose={onClose}>
      <p className="muted small">The Order agent reads it the same way as an emailed PO.</p>
      <label className={`drop-zone${dragging ? " dragging" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)} onDrop={onDrop}>
        <input type="file" accept={ACCEPTED_TYPES} className="visually-hidden"
          onChange={(event) => choose(event.target.files?.[0] ?? null)} aria-label="PO file" />
        <strong>Drop the PO file here</strong>
        <span className="muted small">or click to choose (PDF, PNG, JPG, TIFF, up to 20 MB)</span>
      </label>
      {isElectron ? <button type="button" className="link-button" onClick={() => void pickWithDesktopDialog()}>Open file dialog…</button> : null}
      {file ? <p>Selected: <strong>{file.name}</strong></p> : null}
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      <div className="dialog-footer">
        <button type="button" className="button" onClick={onClose}>Cancel</button>
        <button type="button" className="button button-primary" disabled={!file || upload.isPending}
          onClick={() => file && upload.mutate(file)}>{upload.isPending ? "Uploading…" : "Upload"}</button>
      </div>
    </Drawer>
  );
}
