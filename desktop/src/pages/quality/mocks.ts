import { ApiError, registerMock } from "../../api/client";
import type { QcRecordIn, QcRecordOut } from "../../api/types";
import { qcPlans, qcRecords, users } from "../../components/mock-data";

registerMock("GET", "/qc/orders/:orderId", ({ params }) => {
  const plan = qcPlans[params.orderId];
  if (!plan) throw new ApiError(404, "No QC plan");
  return { plan, records: qcRecords.filter((record) => record.order_id === params.orderId) };
});
registerMock("POST", "/qc/records", ({ body }) => {
  const input = body as QcRecordIn;
  const record: QcRecordOut = {
    id: `0f200000-0000-4000-8000-${String(qcRecords.length + 1).padStart(12, "0")}`, order_id: input.order_id, check_name: input.check_name,
    result: input.result, measured_value: input.measured_value ?? null, inspector_id: users[6].id, note: input.note ?? null, created_at: new Date().toISOString(),
  };
  qcRecords.push(record);
  return record;
});
