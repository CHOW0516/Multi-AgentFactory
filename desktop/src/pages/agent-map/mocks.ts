import { ApiError, registerMock } from "../../api/client";
import type { AgentName, AgentSummary, OrderSummary, Page } from "../../api/types";
import { demoAgents, demoInProgress, demoMessageLog, demoOrders } from "../../figures/demo-events";
import { eventToMessage } from "./model";

const scopes: Partial<Record<AgentName, string>> = {
  orchestrator: "Coordinates orders, agent tasks, and manager approvals.",
  order: "Reads purchase orders, validates the extracted fields, and drafts customer replies.",
  material: "Checks material availability, manages stock holds, and raises purchase requests.",
  planning: "Builds capacity-aware schedules and compares plan options.",
  quality: "Prepares inspection plans and checks completion records.",
  monitoring: "Follows shop status and escalates production changes.",
  maintenance: "Records downtime and coordinates machine availability.",
  simulator: "Generates sample orders and shop events for the demonstration.",
};

function summary(name: AgentName): AgentSummary {
  const messages = demoMessageLog().filter((message) => message.from_agent === name || message.to_agent === name);
  const midnight = new Date().setHours(0, 0, 0, 0);
  const today = messages.filter((message) => Date.parse(message.sent_at) >= midnight && message.type === "result" &&
    (name === "orchestrator" || message.from_agent === name));
  const failures = today.filter((message) => message.status === "failed").length;
  return {
    name, job_scope: scopes[name] ?? "", uses_llm: name === "order" || name === "orchestrator",
    queue_depth: 0, in_progress: demoInProgress(name), dead_letter_count: failures,
    success_rate_today: today.length ? (today.length - failures) / today.length : 0,
    average_latency_ms: today.length ? today.reduce((sum, row) => sum + (row.latency_ms ?? 0), 0) / today.length : 0,
    tokens_today: today.reduce((sum, row) => sum + row.tokens_in + row.tokens_out, 0),
    cost_today_usd: today.reduce((sum, row) => sum + row.cost_usd, 0),
    last_seen: messages.at(-1)?.sent_at ?? null,
  };
}

let installed = false;

export function installAgentMocks() {
  if (installed) return;
  installed = true;
  registerMock("GET", "/agents", () => (["orchestrator", ...demoAgents] as const).map(summary));
  registerMock("GET", "/agents/:name", ({ params }) => {
    if (!Object.hasOwn(scopes, params.name)) throw new ApiError(404, "Agent not found");
    return summary(params.name as AgentName);
  });
  registerMock("GET", "/agents/:name/messages", ({ params }) => {
    if (!Object.hasOwn(scopes, params.name)) throw new ApiError(404, "Agent not found");
    return demoMessageLog().filter((message) => message.from_agent === params.name || message.to_agent === params.name)
      .sort((left, right) => Date.parse(right.sent_at) - Date.parse(left.sent_at)).slice(0, 50).map(eventToMessage);
  });
  registerMock("GET", "/orders/:id/messages", ({ params }) =>
    demoMessageLog().filter((message) => message.order_id === params.id).map(eventToMessage));

  const orderMocks = import.meta.glob("../orders/mocks.ts");
  if (!Object.keys(orderMocks).length) {
    registerMock("GET", "/orders", (): Page<OrderSummary> => ({
      items: demoOrders, total: demoOrders.length, page: 1, page_size: 100,
    }));
  }
}
