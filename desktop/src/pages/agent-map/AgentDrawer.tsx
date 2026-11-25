import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../api/client";
import type { AgentMessageOut, AgentSummary, Page } from "../../api/types";
import { stationArt } from "../../figures/agent-geometry";
import { Drawer, formatDateTime, itemsOf, percent, QueryNotice } from "../../figures/figure-ui";
import { messageType, parcelFor, pendingTasks, sortMessages, type Message, type Selection } from "./model";

function MessageItem({ message }: { message: Message }) {
  return <li>
    <details>
      <summary><strong>{message.action.replaceAll("_", " ")}</strong>
        <span className="p5-message-state" data-kind={message.status === "failed" ? "failed" : messageType(message)}>
          {message.status === "failed" ? "failed" : messageType(message)}
        </span>
        <small>{message.from_agent} → {message.to_agent ?? "event exchange"} · {formatDateTime(message.sent_at)}</small>
      </summary>
      <pre>{JSON.stringify(message, null, 2)}</pre>
    </details>
  </li>;
}

export function AgentDrawer({ selection, live, onClose }: { selection: Selection; live: Message[]; onClose: () => void }) {
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

  return <Drawer title={`${stationArt[name].label}${station ? "" : " rail"}`} onClose={onClose} testId="agent-drawer">
    {station && <>
      <QueryNotice pending={summary.isPending} error={summary.isError} retry={() => void summary.refetch()} />
      {stats && <>
        <p>{stats.job_scope}</p>
        <dl className="p5-details">
          {([
            ["Uses an LLM", stats.uses_llm ? "Yes" : "No"], ["Queue depth", stats.queue_depth],
            ["In progress", stats.in_progress], ["Success rate today", percent(stats.success_rate_today)],
            ["Average latency", `${Math.round(stats.average_latency_ms)} ms`], ["Tokens today", stats.tokens_today.toLocaleString()],
            ["Cost today", new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(stats.cost_today_usd)],
            ["Dead-letter count", stats.dead_letter_count],
          ] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        <section><h3>Current tasks</h3>
          <ul className="p5-list">{pending.length ? pending.map((message) => <MessageItem key={message.message_id} message={message} />) :
            <li>{stats.in_progress ? "No corresponding task appears in the recent messages." : "No tasks in progress."}</li>}</ul>
        </section>
      </>}
    </>}
    <section>
      <h3>{station ? "Last 50 messages" : "Recent messages on this link"}</h3>
      <QueryNotice pending={messages.isPending && !recent.length} error={messages.isError} retry={() => void messages.refetch()} />
      <ul className="p5-list">
        {recent.map((message) => <MessageItem key={message.message_id} message={message} />)}
        {messages.isSuccess && !recent.length && <li>No messages yet.</li>}
      </ul>
    </section>
  </Drawer>;
}
