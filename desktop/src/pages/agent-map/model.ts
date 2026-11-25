import type { AgentMessageEventData, AgentMessageOut, AgentName } from "../../api/types";
import { stations, type MapAgent, type Station } from "../../figures/agent-geometry";

export type Selection = { type: "station"; name: MapAgent } | { type: "rail"; name: Station };
export type Message = (AgentMessageOut | AgentMessageEventData);
export type Parcel = { id: string; link: Station; outbound: boolean; kind: "task" | "result" | "event" | "failed" };
export type ScheduledParcel = Parcel & { start: number; end: number };

const stationNames: ReadonlySet<AgentName> = new Set(stations);
export const isStation = (name: AgentName | null): name is Station => name !== null && stationNames.has(name);
export const messageType = (message: Message) => "type" in message ? message.type : message.message_type;

export function parcelFor(message: Message): Parcel | undefined {
  const type = messageType(message);
  const outbound = type === "task" || (type === "event" && !isStation(message.from_agent));
  const link = outbound ? message.to_agent : message.from_agent;
  if (!isStation(link)) return undefined;
  return { id: message.message_id, link, outbound, kind: message.status === "failed" ? "failed" : type };
}

const travel = 1100;
const gap = 245;

export function scheduleParcel(parcel: Parcel, at: number, lane: Map<Station, ScheduledParcel>): ScheduledParcel {
  const previous = lane.get(parcel.link);
  // Opposing parcels use the same track. Let the preceding parcel clear it before entering.
  const available = previous ? (previous.outbound === parcel.outbound ? previous.start + gap : previous.end + gap) : 0;
  const start = Math.max(at, available);
  const scheduled = { ...parcel, start, end: start + travel };
  lane.set(parcel.link, scheduled);
  return scheduled;
}

export function sortMessages(messages: Message[]) {
  const seen = new Set<string>();
  return [...messages].sort((earlier, later) => Date.parse(earlier.sent_at) - Date.parse(later.sent_at)).filter((message) => {
    if (seen.has(message.message_id) || !Number.isFinite(Date.parse(message.sent_at))) return false;
    seen.add(message.message_id);
    return true;
  });
}

export function replayPlan(messages: Message[]) {
  const ordered = sortMessages(messages);
  const origin = ordered.length ? Date.parse(ordered[0].sent_at) : 0;
  const lane = new Map<Station, ScheduledParcel>();
  let lastStart = 0;
  let lastArrival = 0;
  const parcels = ordered.flatMap((message) => {
    const parcel = parcelFor(message);
    if (!parcel) return [];
    const scheduled = scheduleParcel(parcel, Math.max(lastStart, Date.parse(message.sent_at) - origin), lane);
    lastStart = scheduled.start;
    lastArrival = Math.max(lastArrival, scheduled.end + 250);
    return [scheduled];
  });
  const end = ordered.length ? Date.parse(ordered[ordered.length - 1].sent_at) - origin : 0;
  return { ordered, parcels, end: Math.max(end, lastArrival) };
}

export function pendingTasks(messages: Message[]) {
  const pending = new Map<string, Message>();
  for (const message of sortMessages(messages)) {
    const match = `${message.correlation_id ?? message.order_id ?? message.message_id}:${message.action}`;
    if (messageType(message) === "task") pending.set(match, message);
    if (messageType(message) === "result") {
      if ("in_reply_to" in message && message.in_reply_to) {
        const entry = Array.from(pending).find(([, task]) => task.message_id === message.in_reply_to);
        if (entry) pending.delete(entry[0]);
      }
      pending.delete(match);
    }
  }
  return Array.from(pending.values());
}

export function eventToMessage(event: AgentMessageEventData): AgentMessageOut {
  return { ...event, message_type: event.type, cost_usd: String(event.cost_usd) };
}
