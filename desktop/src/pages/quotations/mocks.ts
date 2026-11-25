import { ApiError, registerMock } from "../../api/client";
import type { QuotationIn, QuotationOut, WhatIfRequest, WhatIfResult } from "../../api/types";
import { isoDay, quotations } from "../../components/mock-data";

// Mock rule: dates at least 10 days out are possible; earlier ones are not.
function whatIf(dueDate: string | null): WhatIfResult {
  const earliest = isoDay(10);
  const canMeet = Boolean(dueDate && dueDate >= earliest);
  return {
    can_meet_due_date: canMeet, earliest_finish_date: earliest, material_ready_date: isoDay(4),
    explanation: canMeet ? "CNC-01 has room in that week and the bar stock is on hand."
      : `CNC-01 is full until ${earliest}; overtime could bring it 2 days earlier.`,
  };
}

registerMock("GET", "/quotations", () => quotations);
registerMock("POST", "/quotations", ({ body }) => {
  const input = body as QuotationIn;
  const quotation: QuotationOut = {
    id: `0f100000-0000-4000-8000-${String(quotations.length + 1).padStart(12, "0")}`,
    quote_number: `Q-2026-${String(180 + quotations.length).padStart(4, "0")}`, customer_id: input.customer_id, part_id: input.part_id,
    quantity: String(input.quantity), unit_price: Number(input.unit_price).toFixed(2), quoted_due_date: input.quoted_due_date ?? null, status: "open",
  };
  quotations.unshift(quotation);
  return quotation;
});
registerMock("PATCH", "/quotations/:quotationId", ({ params, body }) => {
  const quotation = quotations.find((candidate) => candidate.id === params.quotationId);
  if (!quotation) throw new ApiError(404, "Quotation not found");
  const input = body as QuotationIn;
  return Object.assign(quotation, { ...input, quantity: String(input.quantity), unit_price: Number(input.unit_price).toFixed(2) });
});
registerMock("POST", "/quotations/:quotationId/check-date", ({ params }) => {
  const quotation = quotations.find((candidate) => candidate.id === params.quotationId);
  if (!quotation) throw new ApiError(404, "Quotation not found");
  return whatIf(quotation.quoted_due_date);
});
registerMock("POST", "/plan/what-if", ({ body }) => whatIf((body as WhatIfRequest).due_date));
