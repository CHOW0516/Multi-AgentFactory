import type { TimelineEntry } from "../../api/types";
import { formatDateTime } from "../../components/format";

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) return <p className="empty-state">No history yet.</p>;
  return (
    <ol className="timeline">
      {entries.map((entry, index) => (
        <li key={`${entry.at}-${index}`} className={`kind-${entry.kind}`}>
          <div className="timeline-time">{formatDateTime(entry.at)}{entry.actor ? ` · ${entry.actor}` : ""}</div>
          <div>{entry.title}</div>
        </li>
      ))}
    </ol>
  );
}
