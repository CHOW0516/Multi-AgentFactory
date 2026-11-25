// Lets any page open the orchestrator chat panel (global/chat), optionally about one order.
import { create } from "zustand";

interface ChatPanelState {
  open: boolean;
  orderId: string | null;
  orderLabel: string | null;
  openChat(order?: { id: string; label: string }): void;
  closeChat(): void;
}

export const useChatPanel = create<ChatPanelState>((set) => ({
  open: false,
  orderId: null,
  orderLabel: null,
  openChat(order) {
    set(order ? { open: true, orderId: order.id, orderLabel: order.label } : { open: true });
  },
  closeChat() {
    set({ open: false });
  },
}));
