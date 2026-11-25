// Top-bar chat button plus the slide-out orchestrator chat panel.
import { useChatPanel } from "../../components/chat-store";
import "../../components/components.css";
import { Icon } from "../../shell/icons";
import { ChatPanel } from "./ChatPanel";

export default function ChatGlobal() {
  const { open, openChat, closeChat } = useChatPanel();
  return (
    <>
      <button type="button" className="icon-button" aria-label={open ? "Close chat" : "Ask the orchestrator"} aria-expanded={open}
        onClick={() => (open ? closeChat() : openChat())}>
        <Icon name="chat" />
      </button>
      <ChatPanel />
    </>
  );
}
