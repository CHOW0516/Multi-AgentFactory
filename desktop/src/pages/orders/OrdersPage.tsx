import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../../api/client";
import type { CustomerOut, OrderState, OrderSummary, Page } from "../../api/types";
import { DataTable, type Column } from "../../components/DataTable";
import { formatDate, stateLabel } from "../../components/format";
import { PageHeader } from "../../components/PageHeader";
import { useHasRole } from "../../components/roles";
import { OrderStatusBadge, orderTone } from "../../components/StatusBadge";
import { UploadPoDrawer } from "./UploadPoDrawer";

export const ORDER_STATES: OrderState[] = [
  "RECEIVED", "EXTRACTED", "NEEDS_FIELD_CHECK", "VERIFIED", "MATERIAL_CHECKED", "PLANNED", "WAITING_APPROVAL",
  "RECHECKING", "CONFIRMED", "REPLY_DRAFTED", "CUSTOMER_REPLIED", "IN_PRODUCTION", "COMPLETED", "REJECTED",
  "DECLINED", "REPLAN_NEEDED", "FAILED", "WAITING_CUSTOMER", "CANCELLED", "SENDER_REVIEW",
];

interface OrderFilters { status: string; customerId: string; dueBefore: string; lateRiskOnly: boolean; search: string }

export function buildOrdersQuery(filters: OrderFilters): string {
  const query = new URLSearchParams({ page_size: "200" });
  if (filters.status) query.set("status", filters.status);
  if (filters.customerId) query.set("customer_id", filters.customerId);
  if (filters.dueBefore) query.set("due_to", filters.dueBefore);
  if (filters.lateRiskOnly) query.set("late_risk", "true");
  return `/orders?${query.toString()}`;
}

export function OrdersPage() {
  const navigate = useNavigate();
  const canUpload = useHasRole("sales", "manager");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [filters, setFilters] = useState<OrderFilters>({ status: "", customerId: "", dueBefore: "", lateRiskOnly: false, search: "" });
  const ordersPath = buildOrdersQuery(filters);
  const ordersQuery = useQuery({ queryKey: ["orders", ordersPath], queryFn: () => apiFetch<Page<OrderSummary>>(ordersPath) });
  const customersQuery = useQuery({ queryKey: ["customers"], queryFn: () => apiFetch<CustomerOut[] | Page<CustomerOut>>("/customers") });
  const customers = Array.isArray(customersQuery.data) ? customersQuery.data : customersQuery.data?.items ?? [];

  const rows = useMemo(() => {
    const searchText = filters.search.trim().toLowerCase();
    const items = ordersQuery.data?.items ?? [];
    if (!searchText) return items;
    return items.filter((order) => [order.order_number, order.po_number, order.customer_name]
      .some((value) => value?.toLowerCase().includes(searchText)));
  }, [ordersQuery.data, filters.search]);

  const columns: Column<OrderSummary>[] = [
    { key: "order", header: "Order", render: (order) => <strong>{order.order_number}</strong>, sortValue: (order) => order.order_number },
    { key: "po", header: "Customer PO", render: (order) => order.po_number ?? "—" },
    { key: "customer", header: "Customer", render: (order) => order.customer_name ?? "—", sortValue: (order) => order.customer_name ?? "" },
    { key: "status", header: "Status", render: (order) => <OrderStatusBadge state={order.status} />, sortValue: (order) => ORDER_STATES.indexOf(order.status) },
    { key: "due", header: "Due", render: (order) => formatDate(order.due_date), sortValue: (order) => order.due_date ?? "9999" },
    { key: "promised", header: "Promised", render: (order) => formatDate(order.promised_date) },
    { key: "risk", header: "Late risk", render: (order) => (order.late_risk ? <span className="badge badge-problem">At risk</span> : "—") },
  ];

  const update = (change: Partial<OrderFilters>) => setFilters((current) => ({ ...current, ...change }));

  return (
    <div>
      <PageHeader title="Orders" subtitle={`${ordersQuery.data?.total ?? "…"} orders`}
        actions={canUpload ? <button type="button" className="button button-primary" onClick={() => setUploadOpen(true)}>Upload PO</button> : null} />
      <div className="filter-bar" role="search">
        <div className="field">
          <label htmlFor="order-search">Search</label>
          <input id="order-search" placeholder="Order, PO or customer" value={filters.search} onChange={(event) => update({ search: event.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="order-status">Status</label>
          <Select id="order-status" value={filters.status} onChange={(event) => update({ status: event.target.value })}>
            <option value="">All</option>
            {ORDER_STATES.map((state) => <option key={state} value={state}>{stateLabel(state)}</option>)}
          </Select>
        </div>
        <div className="field">
          <label htmlFor="order-customer">Customer</label>
          <Select id="order-customer" value={filters.customerId} onChange={(event) => update({ customerId: event.target.value })}>
            <option value="">All</option>
            {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
          </Select>
        </div>
        <div className="field">
          <label htmlFor="order-due">Due by</label>
          <DatePicker id="order-due" value={filters.dueBefore} onChange={(dueBefore) => update({ dueBefore })} />
        </div>
        <label className="row small">
          <input type="checkbox" checked={filters.lateRiskOnly} onChange={(event) => update({ lateRiskOnly: event.target.checked })} />
          Late risk only
        </label>
      </div>
      <DataTable columns={columns} rows={rows} rowKey={(order) => order.id}
        onRowClick={(order) => navigate(`/orders/${order.id}`)}
        rowClassName={(order) => (orderTone(order.status) === "action" ? "row-action" : order.late_risk ? "row-warning" : "")}
        isLoading={ordersQuery.isPending} error={ordersQuery.error} onRetry={() => void ordersQuery.refetch()}
        emptyText="No orders match these filters." caption="Orders" />
      <UploadPoDrawer open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  );
}
