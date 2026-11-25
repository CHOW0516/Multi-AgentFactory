import { registerMock } from "../../api/client";
import { maintenanceWindows, scheduleSlots } from "../../components/mock-data";

registerMock("GET", "/schedule", ({ query }) => {
  const from = query.has("from") ? Date.parse(query.get("from")!) : -Infinity;
  const to = query.has("to") ? Date.parse(query.get("to")!) : Infinity;
  const machineId = query.get("machine_id");
  return {
    slots: scheduleSlots.filter((slot) => Date.parse(slot.end_at) > from && Date.parse(slot.start_at) < to && (!machineId || slot.machine_id === machineId)),
    maintenance: maintenanceWindows.filter((window) => Date.parse(window.start_at) < to &&
      (window.end_at === null || Date.parse(window.end_at) > from) && (!machineId || window.machine_id === machineId)),
  };
});
