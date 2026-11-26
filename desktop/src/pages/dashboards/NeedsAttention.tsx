// "Needs attention": what the agents found that needs a person today. Built by the backend
// from database queries and fixed sentences (no AI calls).
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiFetch } from "../../api/client";
import type { AttentionItem } from "../../api/types";
import { CompactList } from "../../components/CompactList";
import { QueryState } from "../../components/QueryState";
import { Icon } from "../../shell/icons";

export function NeedsAttention() {
  const query = useQuery({
    queryKey: ["attention"], queryFn: () => apiFetch<AttentionItem[]>("/attention"), refetchInterval: 60_000,
  });
  return (
    <section className="dashboard-section needs-attention" aria-labelledby="needs-attention-heading" data-testid="needs-attention">
      <header className="dashboard-section-heading"><span className="section-symbol"><Icon name="approvals" size={18} /></span>
        <div><h2 id="needs-attention-heading">Needs attention</h2><p>What the agents found that needs a person today.</p></div></header>
      <QueryState query={query}>
        {(items) => (
          <CompactList items={items} label="items" empty="Nothing needs attention. All orders are on track."
            itemKey={(item) => `${item.kind}-${item.link}-${item.title}`}
            render={(item) => (
              <div className="attention-item">
                <span className={`badge ${item.severity === "high" ? "badge-problem" : "badge-action"}`}>
                  {item.severity === "high" ? "Urgent" : "To do"}</span>
                <div className="attention-text"><strong>{item.title}</strong>{item.detail && <small>{item.detail}</small>}</div>
                <Link className="button button-small" to={item.link}>{item.action}</Link>
              </div>
            )} />
        )}
      </QueryState>
    </section>
  );
}
