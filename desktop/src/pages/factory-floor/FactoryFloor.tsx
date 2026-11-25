import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, useLiveEvents } from "../../api/client";
import type { FloorOut, LiveEventDataMap, MachineOverview } from "../../api/types";
import { FigureCard, FigurePage, Metrics, QueryNotice } from "../../figures/figure-ui";
import { useDemoEvents } from "../../figures/demo-events";
import { FloorScene, type CartArrival } from "./FloorScene";
import { MachineDrawer } from "./MachineDrawer";
import { floorKey, issueDestination, overviewKey, statusNames, withMachineStatus } from "./model";

const emptyMachines: FloorOut["machines"] = [];

export function FactoryFloor() {
  const client = useQueryClient();
  const floor = useQuery({ queryKey: floorKey, queryFn: ({ signal }) => apiFetch<FloorOut>("/floor", { signal }), refetchInterval: 30_000 });
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [arrival, setArrival] = useState<CartArrival | null>(null);
  const machines = floor.data?.machines ?? emptyMachines;
  const highlighted = machines.find((machine) => machine.id === hover);
  const machine = machines.find((machine) => machine.id === selected);
  const running = machines.filter((entry) => entry.status === "running").length;

  useDemoEvents();
  useLiveEvents(["machine_status_changed"], (event) => {
    const change = event.data as LiveEventDataMap["machine_status_changed"];
    client.setQueryData<FloorOut>(floorKey, (previous) => withMachineStatus(previous, change.machine_id, change.status));
    client.setQueryData<MachineOverview>(overviewKey(change.machine_id), (previous) =>
      previous && { ...previous, machine: { ...previous.machine, status: change.status } });
    void client.invalidateQueries({ queryKey: floorKey });
    void client.invalidateQueries({ queryKey: overviewKey(change.machine_id) });
  });
  useLiveEvents(["approval_created", "order_state_changed"], () => { void client.invalidateQueries({ queryKey: floorKey }); });
  useLiveEvents(["agent_message"], (event) => {
    const message = event.data as LiveEventDataMap["agent_message"];
    const destination = issueDestination(message, machines);
    if (destination) setArrival({ id: message.message_id, x: destination.floor_x, y: destination.floor_y });
  });

  return <FigurePage title="Factory floor" description="Production status, current jobs, and maintenance across the shop.">
    <Metrics items={[
      ["Machines running", floor.data ? `${running} / ${machines.length}` : "—"],
      ["Orders in production", floor.data?.orders_in_production ?? "—"],
      ["Pending approvals", floor.data?.pending_approvals ?? "—"],
    ]} />
    <QueryNotice pending={floor.isPending} error={floor.isError} retry={() => void floor.refetch()} />
    {floor.data && <>
      <FigureCard number={1} title="Factory floor" hint="Click a machine"
        readout={`${running}/${machines.length} running · ${floor.data.orders_in_production} in production · ${floor.data.pending_approvals} pending`}
        caption={<span className="p5-legend">{Object.entries(statusNames).map(([status, label]) =>
          <span key={status}><i className="p5-status-dot" data-status={status} />{label}</span>)}</span>}>
        <FloorScene machines={machines} approvals={floor.data.pending_approvals} active={hover ?? selected}
          onInspect={setSelected} onHover={setHover} arrival={arrival} />
      </FigureCard>
      <div className="p5-inspect" aria-live="polite">
        {highlighted ? <>
          <strong>{highlighted.name}</strong>
          <span><i className="p5-status-dot" data-status={highlighted.status} />{statusNames[highlighted.status]}</span>
          <span>{highlighted.current_order_number ?? "No current order"}</span><span>{highlighted.part_count} parts</span>
        </> : "Hover or focus a machine to see its current job."}
      </div>
      {machines.length === 0 && <p className="p5-notice">No machines are registered.</p>}
    </>}
    {machine && <MachineDrawer key={machine.id} machine={machine} onClose={() => setSelected(null)} />}
  </FigurePage>;
}
