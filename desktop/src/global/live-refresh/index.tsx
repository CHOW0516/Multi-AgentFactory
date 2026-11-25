// Keeps every page fresh: live events invalidate the TanStack Query caches they affect.
import { useQueryClient } from "@tanstack/react-query";
import { useLiveEvents } from "../../api/client";
import type { LiveEvent } from "../../api/types";

type RefreshEvent = LiveEvent<"order_state_changed" | "approval_created" | "machine_status_changed">;

/** Query key prefixes to refresh for an event. */
export function queryKeysFor(event: RefreshEvent): string[][] {
  switch (event.type) {
    case "order_state_changed": return [["orders"], ["approvals"], ["schedule"], ["dashboard"], ["materials"], ["qc"]];
    case "approval_created": return [["approvals"], ["dashboard"]];
    case "machine_status_changed": return [["machines"], ["schedule"], ["floor"], ["dashboard"]];
    default: return [];
  }
}

export default function LiveRefresh() {
  const queryClient = useQueryClient();
  useLiveEvents(["order_state_changed", "approval_created", "machine_status_changed"], (event) => {
    for (const queryKey of queryKeysFor(event)) void queryClient.invalidateQueries({ queryKey });
  });
  return null;
}
