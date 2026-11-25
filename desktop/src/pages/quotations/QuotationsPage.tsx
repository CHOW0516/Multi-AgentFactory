import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { apiFetch } from "../../api/client";
import type { CustomerOut, Page, PartOut, QuotationIn, QuotationOut, WhatIfResult } from "../../api/types";
import { itemsOf } from "../../components/api-helpers";
import { DataTable, type Column } from "../../components/DataTable";
import { Drawer } from "../../components/Dialog";
import { formatDate, formatNumber } from "../../components/format";
import { Money } from "../../components/Money";
import { PageHeader } from "../../components/PageHeader";

export function QuotationsPage() {
  const [editing, setEditing] = useState<QuotationOut | "new" | null>(null);
  const [checking, setChecking] = useState<QuotationOut | null>(null);
  const [statusFilter, setStatusFilter] = useState("open");
  const quotationsQuery = useQuery({ queryKey: ["quotations"], queryFn: () => apiFetch<QuotationOut[] | Page<QuotationOut>>("/quotations") });
  const customersQuery = useQuery({ queryKey: ["customers"], queryFn: () => apiFetch<CustomerOut[]>("/customers") });
  const partsQuery = useQuery({ queryKey: ["parts"], queryFn: () => apiFetch<PartOut[]>("/parts") });
  const customers = itemsOf(customersQuery.data);
  const parts = itemsOf(partsQuery.data);
  const customerName = (customerId: string) => customers.find((customer) => customer.id === customerId)?.name ?? "—";
  const partLabel = (partId: string) => { const part = parts.find((candidate) => candidate.id === partId); return part ? `${part.part_number} rev ${part.revision}` : "—"; };
  const rows = itemsOf(quotationsQuery.data).filter((quotation) => !statusFilter || quotation.status === statusFilter);

  const columns: Column<QuotationOut>[] = [
    { key: "number", header: "Quote", render: (quotation) => <strong>{quotation.quote_number}</strong>, sortValue: (quotation) => quotation.quote_number },
    { key: "customer", header: "Customer", render: (quotation) => customerName(quotation.customer_id), sortValue: (quotation) => customerName(quotation.customer_id) },
    { key: "part", header: "Part", render: (quotation) => partLabel(quotation.part_id) },
    { key: "quantity", header: "Quantity", align: "right", render: (quotation) => formatNumber(quotation.quantity) },
    { key: "price", header: "Unit price", align: "right", render: (quotation) => <Money value={quotation.unit_price} /> },
    { key: "date", header: "Quoted date", render: (quotation) => formatDate(quotation.quoted_due_date), sortValue: (quotation) => quotation.quoted_due_date ?? "9999" },
    { key: "status", header: "Status", render: (quotation) => <span className={`badge${quotation.status === "open" ? " badge-action" : ""}`}>{quotation.status}</span> },
    { key: "actions", header: "", render: (quotation) => (
      <span className="row">
        <button type="button" className="button button-small" onClick={(event) => { event.stopPropagation(); setChecking(quotation); }}>Can we make this date?</button>
        {quotation.status === "open" ? <button type="button" className="link-button small" onClick={(event) => { event.stopPropagation(); setEditing(quotation); }}>Edit</button> : null}
      </span>
    ) },
  ];

  return (
    <div>
      <PageHeader title="Quotations" subtitle="Prices and dates promised to customers. A PO is checked against its quotation."
        actions={<button type="button" className="button button-primary" onClick={() => setEditing("new")}>New quotation</button>} />
      <div className="filter-bar">
        <div className="field">
          <label htmlFor="quote-status">Status</label>
          <Select id="quote-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">All</option><option value="open">Open</option><option value="accepted">Accepted</option>
            <option value="expired">Expired</option><option value="cancelled">Cancelled</option>
          </Select>
        </div>
      </div>
      <DataTable columns={columns} rows={rows} rowKey={(quotation) => quotation.id} isLoading={quotationsQuery.isPending}
        error={quotationsQuery.error} onRetry={() => void quotationsQuery.refetch()} emptyText="No quotations." caption="Quotations" />
      <Drawer open={editing !== null} title={editing === "new" ? "New quotation" : "Edit quotation"} onClose={() => setEditing(null)} wide>
        {editing !== null ? <QuotationForm quotation={editing === "new" ? null : editing} customers={customers} parts={parts} onDone={() => setEditing(null)} /> : null}
      </Drawer>
      <Drawer open={checking !== null} title="Can we make this date?" onClose={() => setChecking(null)}>
        {checking ? <DateCheck quotation={checking} label={`${checking.quote_number} · ${partLabel(checking.part_id)} · ${formatNumber(checking.quantity)} pcs`} /> : null}
      </Drawer>
    </div>
  );
}

function WhatIfAnswer({ result }: { result: WhatIfResult }) {
  return (
    <div className={`banner${result.can_meet_due_date ? "" : " banner-warning"}`} role="status">
      <strong>{result.can_meet_due_date ? "Yes, the date works." : "No, not by that date."}</strong>
      <div className="small">Earliest finish {formatDate(result.earliest_finish_date)} · material ready {formatDate(result.material_ready_date)}</div>
      {result.explanation ? <p className="small" style={{ marginBottom: 0 }}>{result.explanation}</p> : null}
    </div>
  );
}

function DateCheck({ quotation, label }: { quotation: QuotationOut; label: string }) {
  const check = useQuery({
    queryKey: ["quotations", quotation.id, "check-date"],
    queryFn: () => apiFetch<WhatIfResult>(`/quotations/${quotation.id}/check-date`, { method: "POST" }),
    staleTime: 0,
  });
  return (
    <div className="stack">
      <p className="small muted">{label}, wanted by {formatDate(quotation.quoted_due_date)}. This is a what-if: nothing is booked.</p>
      {check.isPending ? <p className="muted">Checking the schedule and stock…</p> : null}
      {check.isError ? <p className="error-text" role="alert">Could not check: {check.error.message}</p> : null}
      {check.data ? <WhatIfAnswer result={check.data} /> : null}
    </div>
  );
}

function QuotationForm({ quotation, customers, parts, onDone }: {
  quotation: QuotationOut | null; customers: CustomerOut[]; parts: PartOut[]; onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState(quotation?.customer_id ?? "");
  const [partId, setPartId] = useState(quotation?.part_id ?? "");
  const [quantity, setQuantity] = useState(quotation?.quantity ?? "");
  const [unitPrice, setUnitPrice] = useState(quotation?.unit_price ?? "");
  const [dueDate, setDueDate] = useState(quotation?.quoted_due_date ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const customerParts = parts.filter((part) => !customerId || part.customer_id === customerId || part.customer_id === null);

  const save = useMutation({
    mutationFn: (input: QuotationIn) => (quotation
      ? apiFetch(`/quotations/${quotation.id}`, { method: "PATCH", body: input })
      : apiFetch("/quotations", { method: "POST", body: input })),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["quotations"] }); onDone(); },
  });
  const whatIf = useMutation({
    mutationFn: () => apiFetch<WhatIfResult>("/plan/what-if", { method: "POST", body: { part_id: partId, quantity: Number(quantity), due_date: dueDate } }),
  });

  function validate(): string | null {
    if (!customerId || !partId) return "Choose a customer and a part.";
    if (!(Number(quantity) > 0)) return "Quantity must be more than 0.";
    if (!(Number(unitPrice) > 0)) return "Unit price must be more than 0.";
    return null;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const found = validate();
    setProblem(found);
    if (!found) save.mutate({ customer_id: customerId, part_id: partId, quantity: Number(quantity), unit_price: Number(unitPrice), quoted_due_date: dueDate || null });
  }

  return (
    <form onSubmit={submit} aria-label="Quotation" noValidate>
      <div className="field">
        <label htmlFor="quote-customer">Customer</label>
        <Select id="quote-customer" value={customerId} onChange={(event) => { setCustomerId(event.target.value); setPartId(""); }}>
          <option value="">Choose…</option>
          {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
        </Select>
      </div>
      <div className="field">
        <label htmlFor="quote-part">Part</label>
        <Select id="quote-part" value={partId} onChange={(event) => setPartId(event.target.value)}>
          <option value="">Choose…</option>
          {customerParts.map((part) => <option key={part.id} value={part.id}>{part.part_number} rev {part.revision} · {part.description}</option>)}
        </Select>
      </div>
      <div className="grid-3">
        <div className="field"><label htmlFor="quote-quantity">Quantity</label>
          <input id="quote-quantity" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></div>
        <div className="field"><label htmlFor="quote-price">Unit price</label>
          <input id="quote-price" inputMode="decimal" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} /></div>
        <div className="field"><label htmlFor="quote-date">Delivery date</label>
          <DatePicker id="quote-date" value={dueDate} onChange={setDueDate} /></div>
      </div>
      <button type="button" className="button" disabled={!partId || !(Number(quantity) > 0) || !dueDate || whatIf.isPending} onClick={() => whatIf.mutate()}>
        {whatIf.isPending ? "Checking…" : "Can we make this date?"}
      </button>
      {whatIf.data ? <div style={{ marginTop: 12 }}><WhatIfAnswer result={whatIf.data} /></div> : null}
      {whatIf.isError ? <p className="error-text">Could not check: {whatIf.error.message}</p> : null}
      {problem ? <p className="error-text" role="alert">{problem}</p> : null}
      {save.isError ? <p className="error-text" role="alert">Could not save: {save.error.message}</p> : null}
      <div className="dialog-footer">
        <button type="button" className="button" onClick={onDone}>Cancel</button>
        <button type="submit" className="button button-primary" disabled={save.isPending}>{quotation ? "Save changes" : "Create quotation"}</button>
      </div>
    </form>
  );
}
