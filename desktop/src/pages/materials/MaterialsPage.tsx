import { Select } from "../../components/Select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../../api/client";
import type { MaterialOut, OrderSummary, Page, PurchaseRequestOut, StockHoldOut } from "../../api/types";
import { itemsOf } from "../../components/api-helpers";
import { DataTable, type Column } from "../../components/DataTable";
import { Drawer } from "../../components/Dialog";
import { formatDate, formatDateTime, formatNumber, timeSince } from "../../components/format";
import { Money } from "../../components/Money";
import { PageHeader } from "../../components/PageHeader";
import { useCanSeePrices, useHasRole } from "../../components/roles";
import { MovementForm } from "./MovementForm";

type Tab = "stock" | "holds" | "shortages" | "count";
const TAB_LABELS: Record<Tab, string> = { stock: "Stock", holds: "Holds", shortages: "Shortages and purchases", count: "Cycle count" };

export function MaterialsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("stock");
  const [movementOpen, setMovementOpen] = useState(false);
  const [search, setSearch] = useState("");
  const canEdit = useHasRole("store");
  const canSeePrices = useCanSeePrices();
  const materialsQuery = useQuery({ queryKey: ["materials"], queryFn: () => apiFetch<MaterialOut[] | Page<MaterialOut>>("/materials") });
  const materials = itemsOf(materialsQuery.data);
  const codeOf = (materialId: string) => materials.find((material) => material.id === materialId)?.code ?? "—";
  const visibleMaterials = materials.filter((material) => `${material.code} ${material.name}`.toLowerCase().includes(search.trim().toLowerCase()));

  const stockColumns: Column<MaterialOut>[] = [
    { key: "code", header: "Code", render: (material) => <strong>{material.code}</strong>, sortValue: (material) => material.code },
    { key: "name", header: "Name", render: (material) => material.name, sortValue: (material) => material.name },
    { key: "stock", header: "Stock", align: "right", render: (material) => `${formatNumber(material.stock)} ${material.unit}`, sortValue: (material) => Number(material.stock) },
    { key: "held", header: "Held", align: "right", render: (material) => formatNumber(material.held) },
    { key: "available", header: "Available", align: "right", render: (material) => formatNumber(material.available), sortValue: (material) => Number(material.available) },
    { key: "min", header: "Min", align: "right", render: (material) => formatNumber(material.min_stock) },
    { key: "cost", header: "Unit cost", align: "right", hidden: !canSeePrices, render: (material) => <Money value={material.unit_cost} /> },
    { key: "counted", header: "Last counted", render: (material) => (material.last_counted_at ? `${timeSince(material.last_counted_at)} ago` : "Never"),
      sortValue: (material) => material.last_counted_at ?? "" },
    { key: "warnings", header: "", render: (material) => (material.warnings.length > 0
      ? <span className="mismatch" data-tooltip={material.warnings.join(". ")} aria-label={material.warnings.join(". ")}>⚠ {material.warnings.length}</span> : null) },
  ];

  return (
    <div>
      <PageHeader title="Materials" subtitle="Stock, holds for orders, shortages and counts."
        actions={canEdit ? <button type="button" className="button button-primary" onClick={() => setMovementOpen(true)}>Record movement</button> : null} />
      <div className="tabs" role="tablist" aria-label="Material views">
        {(Object.keys(TAB_LABELS) as Tab[]).filter((key) => key !== "count" || canEdit).map((key) => (
          <button key={key} type="button" role="tab" className="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{TAB_LABELS[key]}</button>
        ))}
      </div>
      {tab === "stock" ? (
        <>
          <div className="filter-bar" role="search">
            <div className="field">
              <label htmlFor="material-search">Search</label>
              <input id="material-search" placeholder="Code or name" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
          </div>
          <DataTable columns={stockColumns} rows={visibleMaterials} rowKey={(material) => material.id}
            onRowClick={(material) => navigate(`/materials/${material.id}`)}
            rowClassName={(material) => (material.warnings.length > 0 ? "row-warning" : "")}
            isLoading={materialsQuery.isPending} error={materialsQuery.error} onRetry={() => void materialsQuery.refetch()}
            emptyText="No materials found." caption="Material stock" />
        </>
      ) : null}
      {tab === "holds" ? <HoldsTab codeOf={codeOf} /> : null}
      {tab === "shortages" ? <ShortagesTab materials={materials} codeOf={codeOf} /> : null}
      {tab === "count" && canEdit ? <CycleCountTab materials={materials} /> : null}
      <Drawer open={movementOpen} title="Record a stock movement" onClose={() => setMovementOpen(false)}>
        <MovementForm materials={materials} />
      </Drawer>
    </div>
  );
}

function HoldsTab({ codeOf }: { codeOf: (materialId: string) => string }) {
  const holdsQuery = useQuery({ queryKey: ["materials", "holds"], queryFn: () => apiFetch<StockHoldOut[] | Page<StockHoldOut>>("/holds") });
  const ordersQuery = useQuery({ queryKey: ["orders", "all"], queryFn: () => apiFetch<Page<OrderSummary>>("/orders?page_size=200") });
  const orderNumber = (orderId: string) => ordersQuery.data?.items.find((order) => order.id === orderId)?.order_number ?? orderId.slice(0, 8);
  const columns: Column<StockHoldOut>[] = [
    { key: "material", header: "Material", render: (hold) => codeOf(hold.material_id) },
    { key: "order", header: "Order", render: (hold) => orderNumber(hold.order_id) },
    { key: "quantity", header: "Quantity", align: "right", render: (hold) => formatNumber(hold.quantity) },
    { key: "type", header: "Type", render: (hold) => (hold.hold_type === "firm" ? <span className="badge">Firm</span> : <span className="badge badge-action">Temporary</span>) },
    { key: "expires", header: "Expires", render: (hold) => formatDateTime(hold.expires_at), sortValue: (hold) => hold.expires_at ?? "9999" },
  ];
  return <DataTable columns={columns} rows={itemsOf(holdsQuery.data)} rowKey={(hold) => hold.id} isLoading={holdsQuery.isPending}
    error={holdsQuery.error} onRetry={() => void holdsQuery.refetch()} emptyText="No stock is held." caption="Stock holds" />;
}

function ShortagesTab({ materials, codeOf }: { materials: MaterialOut[]; codeOf: (materialId: string) => string }) {
  const requestsQuery = useQuery({ queryKey: ["materials", "purchase-requests"], queryFn: () => apiFetch<PurchaseRequestOut[] | Page<PurchaseRequestOut>>("/purchase-requests") });
  const short = materials.filter((material) => Number(material.available) < Number(material.min_stock));
  const requestColumns: Column<PurchaseRequestOut>[] = [
    { key: "material", header: "Material", render: (request) => codeOf(request.material_id) },
    { key: "quantity", header: "Quantity", align: "right", render: (request) => formatNumber(request.quantity) },
    { key: "needed", header: "Needed by", render: (request) => formatDate(request.needed_by), sortValue: (request) => request.needed_by ?? "9999" },
    { key: "status", header: "Status", render: (request) => <span className="badge">{request.status}</span> },
  ];
  return (
    <div className="stack">
      <section className="card compact" aria-label="Below minimum stock">
        <h2 className="section-title">Below minimum ({short.length})</h2>
        {short.length === 0 ? <p className="muted small">Every material is above its minimum.</p> : (
          <ul className="small">{short.map((material) => (
            <li key={material.id}><strong>{material.code}</strong> {material.name}: {formatNumber(material.available)} available, minimum {formatNumber(material.min_stock)} {material.unit}</li>
          ))}</ul>
        )}
      </section>
      <section aria-label="Purchase requests">
        <h2 className="section-title">Purchase requests</h2>
        <DataTable columns={requestColumns} rows={itemsOf(requestsQuery.data)} rowKey={(request) => request.id} isLoading={requestsQuery.isPending}
          error={requestsQuery.error} onRetry={() => void requestsQuery.refetch()} emptyText="No open purchase requests." caption="Purchase requests" />
      </section>
    </div>
  );
}

function CycleCountTab({ materials }: { materials: MaterialOut[] }) {
  const queryClient = useQueryClient();
  const [materialId, setMaterialId] = useState("");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const material = materials.find((candidate) => candidate.id === materialId);
  const save = useMutation({
    mutationFn: () => apiFetch("/cycle-counts", { method: "POST", body: { material_id: materialId, counted_quantity: Number(counted), note: note.trim() || null } }),
    onSuccess: () => { setCounted(""); setNote(""); void queryClient.invalidateQueries({ queryKey: ["materials"] }); },
  });
  // Oldest counts first: these need counting most.
  const byOldestCount = [...materials].sort((first, second) => (first.last_counted_at ?? "").localeCompare(second.last_counted_at ?? ""));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!material) { setProblem("Choose a material."); return; }
    if (counted.trim() === "" || Number.isNaN(Number(counted)) || Number(counted) < 0) { setProblem("Enter the counted quantity (0 or more)."); return; }
    setProblem(null);
    save.mutate();
  }

  const difference = material && counted !== "" ? Number(counted) - Number(material.stock) : null;
  return (
    <form className="card compact" style={{ maxWidth: 520 }} onSubmit={submit} aria-label="Cycle count" noValidate>
      <div className="field">
        <label htmlFor="count-material">Material (oldest count first)</label>
        <Select id="count-material" value={materialId} onChange={(event) => setMaterialId(event.target.value)}>
          <option value="">Choose…</option>
          {byOldestCount.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.code} · counted {candidate.last_counted_at ? `${timeSince(candidate.last_counted_at)} ago` : "never"}
            </option>
          ))}
        </Select>
      </div>
      <div className="field">
        <label htmlFor="count-quantity">Counted quantity{material ? ` (${material.unit})` : ""}</label>
        <input id="count-quantity" inputMode="decimal" value={counted} onChange={(event) => setCounted(event.target.value)} />
        {difference !== null && !Number.isNaN(difference) ? (
          <span className={`small${difference !== 0 ? " mismatch" : " muted"}`}>
            System says {formatNumber(material?.stock)}; difference {difference > 0 ? "+" : ""}{formatNumber(difference)}
          </span>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="count-note">Note</label>
        <input id="count-note" value={note} onChange={(event) => setNote(event.target.value)} />
      </div>
      {problem ? <p className="error-text" role="alert">{problem}</p> : null}
      {save.isSuccess ? <p className="small" role="status">✓ Count saved.</p> : null}
      {save.isError ? <p className="error-text" role="alert">Could not save: {save.error.message}</p> : null}
      <button type="submit" className="button button-primary" disabled={save.isPending}>Save count</button>
    </form>
  );
}
