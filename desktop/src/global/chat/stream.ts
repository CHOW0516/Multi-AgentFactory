// Streams the orchestrator's reply from POST /chat. Each chunk is plain text.
// Lines that start with "[tool] " say which tool the orchestrator used (see docs/requests/p4.md).
import { API_BASE_URL, ApiError, USE_MOCKS, apiFetch } from "../../api/client";
import { useAuthStore } from "../../shell/auth-store";

export type StreamChat = (message: string, orderId: string | null, onChunk: (text: string) => void, signal?: AbortSignal) => Promise<void>;

const TOOL_PREFIX = "[tool] ";

/** Separates "[tool] ..." lines from the answer text. */
export function splitToolLines(text: string): { tools: string[]; answer: string } {
  const tools: string[] = [];
  const answerLines: string[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith(TOOL_PREFIX)) tools.push(line.slice(TOOL_PREFIX.length).trim());
    else answerLines.push(line);
  }
  return { tools, answer: answerLines.join("\n").trim() };
}

export const streamChat: StreamChat = async (message, orderId, onChunk, signal) => {
  const body = { message, order_id: orderId };
  if (USE_MOCKS) {
    const reply = await apiFetch<string>("/chat", { method: "POST", body });
    for (const piece of reply.match(/[\s\S]{1,12}/g) ?? []) {
      if (signal?.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
      onChunk(piece);
    }
    return;
  }
  const token = useAuthStore.getState().token;
  const response = await fetch(`${API_BASE_URL}/api/chat`, {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (response.status === 401) useAuthStore.getState().logout();
  if (!response.ok || !response.body) throw new ApiError(response.status, `Chat failed (${response.status})`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(decoder.decode(value, { stream: true }));
  }
};
