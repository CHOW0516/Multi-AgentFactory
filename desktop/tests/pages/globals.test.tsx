import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { emitMockEvent } from "../../src/api/client";
import type { LiveEvent } from "../../src/api/types";
import { useChatPanel } from "../../src/components/chat-store";
import { ChatMarkdown, parseBlocks } from "../../src/global/chat/ChatMarkdown";
import { ChatPanel } from "../../src/global/chat/ChatPanel";
import { splitToolLines, type StreamChat } from "../../src/global/chat/stream";
import LiveRefresh, { queryKeysFor } from "../../src/global/live-refresh";
import NotificationsGlobal, { isForUser } from "../../src/global/notifications";
import { desktop } from "../../src/shell/desktop-bridge";
import { logInAs, renderPage } from "./helpers";
import userEvent from "@testing-library/user-event";

vi.mock("../../src/api/client", async (importOriginal) => (await import("./mock-api")).mockedClient(importOriginal));

describe("chat", () => {
  it("streams the reply and shows the tools used", async () => {
    const stream: StreamChat = async (_message, orderId, onChunk) => {
      expect(orderId).toBe("order-1");
      for (const chunk of ["[tool] get_order(SO-1)\n", "The order ", "is on time."]) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        onChunk(chunk);
      }
    };
    act(() => useChatPanel.setState({ open: true, orderId: "order-1", orderLabel: "SO-1" }));
    render(<ChatPanel stream={stream} />);
    expect(screen.getByText("About SO-1")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Message"), "Is it late?{Enter}");
    expect(await screen.findByText("Is it late?")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("The order is on time.")).toBeInTheDocument());
    expect(screen.getByText(/get_order\(SO-1\)/)).toBeInTheDocument();
  });

  it("shows a clear message when the reply fails", async () => {
    const stream: StreamChat = async () => { throw new Error("down"); };
    act(() => useChatPanel.setState({ open: true, orderId: null, orderLabel: null }));
    render(<ChatPanel stream={stream} />);
    await userEvent.type(screen.getByLabelText("Message"), "Hello{Enter}");
    await waitFor(() => expect(screen.getByText(/could not answer/)).toBeInTheDocument());
  });

  it("splits tool lines from the answer", () => {
    expect(splitToolLines("[tool] a()\nHello\n[tool] b()\nworld")).toEqual({ tools: ["a()", "b()"], answer: "Hello\nworld" });
  });

  it("shows a Markdown table, list and bold text formatted", () => {
    const reply = "The factory has **7 machines**:\n\n| Code | Status |\n| :--- | :--- |\n| **LATHE-01** | Running |\n| MILL-01 | Idle |\n\n- one\n- two";
    const { container } = render(<ChatMarkdown text={reply} />);
    expect(container.querySelector("table")).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "Code" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "LATHE-01" }).querySelector("strong")).not.toBeNull();
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(container.textContent).not.toContain("|");
    expect(container.textContent).not.toContain("**");
  });

  it("splits Markdown into blocks", () => {
    expect(parseBlocks("## Title\nline one\nline two\n\n1. a\n2. b").map((block) => block.kind)).toEqual(["heading", "paragraph", "numbers"]);
    expect(parseBlocks("| a | b |\n| 1 | 2 |")).toEqual([{ kind: "table", header: [], rows: [["a", "b"], ["1", "2"]] }]);
  });

  it("shows a tool used twice once, with a count", async () => {
    const stream: StreamChat = async (_message, _orderId, onChunk) => { onChunk("[tool] get_machine_overview\n[tool] get_machine_overview\nDone."); };
    act(() => useChatPanel.setState({ open: true, orderId: null, orderLabel: null }));
    render(<ChatPanel stream={stream} />);
    await userEvent.type(screen.getByLabelText("Message"), "Machines?{Enter}");
    await waitFor(() => expect(screen.getByText("⚙ get_machine_overview ×2")).toBeInTheDocument());
  });
});

const notificationEvent = (userIds: string[]): LiveEvent<"notification"> => ({
  type: "notification", at: new Date().toISOString(),
  data: { user_ids: userIds, kind: "approval_created", title: "Approval needed: SO-9", body: "Plan ready", link: "/approvals" },
});

describe("notifications", () => {
  it("shows a toast and a desktop notification for a live event", async () => {
    const user = logInAs("manager");
    const notify = vi.spyOn(desktop, "notify").mockResolvedValue();
    renderPage(<NotificationsGlobal />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Notifications, \d+ unread/ })).toBeInTheDocument());
    act(() => emitMockEvent(notificationEvent([user.id])));
    expect(await screen.findByText("Approval needed: SO-9")).toBeInTheDocument();
    expect(notify).toHaveBeenCalledWith("Approval needed: SO-9", "Plan ready");
  });

  it("ignores notifications meant for someone else", () => {
    expect(isForUser(notificationEvent(["someone-else"]), "me")).toBe(false);
    expect(isForUser(notificationEvent([]), "me")).toBe(true);
    expect(isForUser(notificationEvent(["me"]), "me")).toBe(true);
  });
});

describe("live refresh", () => {
  it("invalidates the queries each event affects", () => {
    logInAs("manager");
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(<QueryClientProvider client={client}><MemoryRouter><LiveRefresh /></MemoryRouter></QueryClientProvider>);
    act(() => emitMockEvent({ type: "order_state_changed", at: "", data: { order_id: "o1", from_state: "PLANNED", to_state: "WAITING_APPROVAL" } }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["orders"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["approvals"] });
    invalidate.mockClear();
    act(() => emitMockEvent({ type: "machine_status_changed", at: "", data: { machine_id: "m1", status: "down" } }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["schedule"] });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["orders"] });
  });

  it("maps approval events to the inbox", () => {
    expect(queryKeysFor({ type: "approval_created", at: "", data: { approval_id: "a", order_id: "o", approval_type: "order" } })).toContainEqual(["approvals"]);
  });
});
