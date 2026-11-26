import { useEffect, useRef, useState, type FormEvent } from "react";
import { useChatPanel } from "../../components/chat-store";
import { ChatMarkdown } from "./ChatMarkdown";
import { splitToolLines, streamChat, type StreamChat } from "./stream";

/** The same tool used twice shows once, with a count. */
function countTools(tools: string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const tool of tools) counts.set(tool, (counts.get(tool) ?? 0) + 1);
  return [...counts];
}

interface ChatMessage { id: number; from: "you" | "orchestrator"; text: string; failed?: boolean }

const SUGGESTIONS = ["What needs my attention today?", "Why is this order late?", "Which machines are overloaded this week?"];

export function ChatPanel({ stream = streamChat }: { stream?: StreamChat }) {
  const { open, orderId, orderLabel, closeChat } = useChatPanel();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: "end" }); }, [messages]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closeChat(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeChat]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    // Two separate Date.now() calls can return ids that collide, so derive both from one value.
    const questionId = Date.now();
    const replyId = questionId + 0.5;
    setMessages((current) => [...current, { id: questionId, from: "you", text: question }, { id: replyId, from: "orchestrator", text: "" }]);
    setInput("");
    setBusy(true);
    abortRef.current = new AbortController();
    try {
      await stream(question, orderId, (chunk) => {
        setMessages((current) => current.map((message) => (message.id === replyId ? { ...message, text: message.text + chunk } : message)));
      }, abortRef.current.signal);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setMessages((current) => current.map((message) => (message.id === replyId
          ? { ...message, failed: true, text: message.text || "The orchestrator could not answer. Try again." } : message)));
      }
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  if (!open) return null;
  return (
    <aside className="chat-panel" role="complementary" aria-label="Orchestrator chat">
      <div className="drawer-header">
        <div>
          <h2 style={{ margin: 0, fontSize: 16 }}>Ask the orchestrator</h2>
          {orderLabel ? <span className="small muted">About {orderLabel}</span> : null}
        </div>
        <button type="button" className="icon-button" onClick={closeChat} aria-label="Close chat">✕</button>
      </div>
      <div className="chat-messages" aria-live="polite">
        {messages.length === 0 ? (
          <div className="stack small">
            <p className="muted">Ask about orders, plans, stock or machines. It answers from the live data and says which tools it used.</p>
            {SUGGESTIONS.map((suggestion) => (
              <button key={suggestion} type="button" className="button button-small" onClick={() => void send(suggestion)}>{suggestion}</button>
            ))}
          </div>
        ) : messages.map((message) => {
          if (message.from === "you") return <div key={message.id} className="chat-bubble chat-you">{message.text}</div>;
          const { tools, answer } = splitToolLines(message.text);
          return (
            <div key={message.id} className={`chat-bubble chat-reply${message.failed ? " chat-failed" : ""}`}>
              {tools.length > 0 ? (
                <div className="chat-tools">{countTools(tools).map(([tool, count]) => (
                  <span key={tool} className="badge">⚙ {tool}{count > 1 ? ` ×${count}` : ""}</span>
                ))}</div>
              ) : null}
              {answer ? <ChatMarkdown text={answer} /> : busy ? <span className="muted">Thinking…</span> : null}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <form className="chat-input" onSubmit={submit}>
        <textarea ref={inputRef} aria-label="Message" rows={2} value={input} placeholder="Type a question…"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(input); } }} />
        {busy ? (
          <button type="button" className="button" onClick={() => abortRef.current?.abort()}>Stop</button>
        ) : (
          <button type="submit" className="button button-primary" disabled={!input.trim()}>Send</button>
        )}
      </form>
    </aside>
  );
}
