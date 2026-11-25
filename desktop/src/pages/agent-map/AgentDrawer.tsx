import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../api/client";
import type { AgentMessageOut, AgentSummary, Page } from "../../api/types";
import { stationArt } from "../../figures/agent-geometry";
import { formatDateTime, itemsOf, percent, QueryNotice } from "../../figures/figure-ui";
import { Inspector } from "../../components/Inspector";
import { CompactList } from "../../components/CompactList";
import { messageType, parcelFor, pendingTasks, sortMessages, type Message, type Selection } from "./model";

function MessageContent({ message }: { message: Message }) {
  return <details>
      <summary><strong>{message.action.replaceAll("_", " ")}</strong>
        <span className="p5-message-state" data-kind={message.status === "failed" ? "failed" : messageType(message)}>
          {message.status === "failed" ? "failed" : messageType(message)}
        </span>
        <small>{message.from_agent} → {message.to_agent ?? "event exchange"} · {formatDateTime(message.sent_at)}</small>
      </summary>
      <pre>{JSON.stringify(message, null, 2)}</pre>
  </details>;
}

export function AgentDrawer({ selection, live, onClose, onLocate }: { selection: Selection; live: Message[]; onClose: () => void; onLocate: () => void }) {
  const name = selection.name;
  const station = selection.type === "station";
  const path = `/agents/${encodeURIComponent(name)}`;
  const summary = useQuery({
    queryKey: ["p5", "agent", name], enabled: station, queryFn: ({ signal }) => apiFetch<AgentSummary>(path, { signal }), refetchInterval: 15_000,
  });
  const messages = useQuery({
    queryKey: ["p5", "agent-messages", name], queryFn: async ({ signal }) =>
      itemsOf(await apiFetch<AgentMessageOut[] | Page<AgentMessageOut>>(`${path}/messages?limit=50`, { signal })),
    refetchInterval: 15_000,
  });
  const matches = live.filter((message) => message.from_agent === name || message.to_agent === name);
  const recent = sortMessages([...matches, ...(messages.data ?? [])]).filter((message) =>
    station || parcelFor(message)?.link === name).reverse().slice(0, 50);
  const pending = pendingTasks(recent).filter((message) => message.to_agent === name);
  const stats = summary.data;

  return <Inspector title={`${stationArt[name].label}${station ? "" : " rail"}`} icon="agents" onLocate={onLocate} onClose={onClose} testId="agent-drawer">
    {station && <>
      <QueryNotice pending={summary.isPending} error={summary.isError} retry={() => void summary.refetch()} />
      {stats && <>
        <p className="agent-scope">{stats.job_scope}</p>
        <dl className="floor-inspector-metrics">
          <div><dt>In progress</dt><dd>{stats.in_progress}</dd></div>
          <div><dt>Queued</dt><dd>{stats.queue_depth}</dd></div>
        </dl>
        <dl className="p5-details">
          <div><dt>Success rate today</dt><dd>{percent(stats.success_rate_today)}</dd></div>
          <div><dt>Average latency</dt><dd>{Math.round(stats.average_latency_ms)} ms</dd></div>
        </dl>
        <section><h3>Current tasks</h3>
          <CompactList items={pending} label="tasks" empty={stats.in_progress ? "No corresponding task appears in the recent messages." : "No tasks in progress."}
            itemKey={(message) => message.message_id} render={(message) => <MessageContent message={message} />} />
        </section>
        <details className="inspector-more inspector-section"><summary>Usage & diagnostics</summary>
          <dl className="p5-details">
            {([
              ["Uses an LLM", stats.uses_llm ? "Yes" : "No"], ["Tokens today", stats.tokens_today.toLocaleString()],
              ["Cost today", new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(stats.cost_today_usd)],
              ["Dead-letter count", stats.dead_letter_count],
            ] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
        </details>
      </>}
    </>}
    <section>
      <h3>{station ? "Last 50 messages" : "Recent messages on this link"}</h3>
      <QueryNotice pending={messages.isPending && !recent.length} error={messages.isError} retry={() => void messages.refetch()} />
      <CompactList items={recent} label="messages" empty="No messages yet." itemKey={(message) => message.message_id}
        render={(message) => <MessageContent message={message} />} />
    </section>
  </Inspector>;
}
