import { registerMock } from "../../api/client";
import { maintenanceWindows, scheduleSlots } from "../../components/mock-data";

registerMock("GET", "/schedule", ({ query }) => {
  const from = query.get("from") ?? "0000";
  const to = `${query.get("to") ?? "9999"}T23:59:59Z`;
  const machineId = query.get("machine_id");
  return {
    slots: scheduleSlots.filter((slot) => slot.end_at >= from && slot.start_at <= to && (!machineId || slot.machine_id === machineId)),
    maintenance: maintenanceWindows.filter((window) => !machineId || window.machine_id === machineId),
  };
});
