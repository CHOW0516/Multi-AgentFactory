// Shows a PO file with Chromium's built-in PDF viewer.
import { USE_MOCKS, fileUrl } from "../api/client";

export function PdfViewer({ path, title = "Purchase order" }: { path: string | null; title?: string }) {
  if (!path) return <p className="empty-state">No document.</p>;
  if (USE_MOCKS) {
    return (
      <div className="pdf-placeholder" role="img" aria-label={title}>
        <strong>{title}</strong>
        <span className="muted">The PDF shows here when connected to the server.</span>
      </div>
    );
  }
  const source = path.startsWith("http") ? path : fileUrl(path.replace(/^\/api/, ""));
  return <iframe className="pdf-viewer" title={title} src={source} />;
}
