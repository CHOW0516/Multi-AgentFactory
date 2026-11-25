import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../../api/client";
import type { MaterialOut, Page, StockMovementOut } from "../../api/types";
import { itemsOf } from "../../components/api-helpers";
import { DataTable, type Column } from "../../components/DataTable";
import { formatDateTime, formatNumber, timeSince } from "../../components/format";
import { Money } from "../../components/Money";
import { PageHeader } from "../../components/PageHeader";
import { QueryState } from "../../components/QueryState";
import { useCanSeePrices, useHasRole } from "../../components/roles";
import { MovementForm } from "../materials/MovementForm";
import { MOVEMENT_LABELS } from "../materials/movement-rules";

export function MaterialDetailPage() {
  const { materialId = "" } = useParams();
  const canEdit = useHasRole("store");
  const canSeePrices = useCanSeePrices();
  const materialQuery = useQuery({ queryKey: ["materials", materialId], queryFn: () => apiFetch<MaterialOut>(`/materials/${materialId}`) });
  const movementsQuery = useQuery({
    queryKey: ["stock-movements", materialId],
    queryFn: () => apiFetch<StockMovementOut[] | Page<StockMovementOut>>(`/stock-movements?material_id=${materialId}`),
  });

  const columns: Column<StockMovementOut>[] = [
    { key: "when", header: "When", render: (movement) => formatDateTime(movement.created_at), sortValue: (movement) => movement.created_at },
    { key: "type", header: "Type", render: (movement) => MOVEMENT_LABELS[movement.movement_type] ?? movement.movement_type },
    { key: "quantity", header: "Quantity", align: "right", render: (movement) => (
      <span className={Number(movement.quantity) < 0 ? "mismatch" : undefined}>{Number(movement.quantity) > 0 ? "+" : ""}{formatNumber(movement.quantity, 0)}</span>
    ) },
    { key: "reference", header: "Reference", render: (movement) => movement.reference ?? "—" },
    { key: "reason", header: "Reason", render: (movement) => movement.reason ?? "—" },
  ];

  return (
    <QueryState query={materialQuery}>
      {(material) => (
        <div className="stack">
          <Link to="/materials" className="small">← Materials</Link>
          <PageHeader title={`${material.code}`} subtitle={material.name} />
          {material.warnings.length > 0 ? <div className="banner banner-warning">{material.warnings.join(". ")}</div> : null}
          <div className="grid-tiles">
            <div className="card compact"><div className="kpi-label">Stock</div><div className="kpi-value">{formatNumber(material.stock)} <span className="kpi-unit">{material.unit}</span></div></div>
            <div className="card compact"><div className="kpi-label">Held for orders</div><div className="kpi-value">{formatNumber(material.held)}</div></div>
            <div className="card compact"><div className="kpi-label">Available</div><div className="kpi-value">{formatNumber(material.available)}</div></div>
            <div className="card compact"><div className="kpi-label">Last counted</div><div className="kpi-value" style={{ fontSize: 18 }}>{material.last_counted_at ? `${timeSince(material.last_counted_at)} ago` : "Never"}</div></div>
            {canSeePrices ? <div className="card compact"><div className="kpi-label">Unit cost</div><div className="kpi-value" style={{ fontSize: 18 }}><Money value={material.unit_cost} /></div></div> : null}
          </div>
          <div className={canEdit ? "split-view" : undefined}>
            <section aria-label="Movement history">
              <h2 className="section-title">Movement history</h2>
              <DataTable columns={columns} rows={itemsOf(movementsQuery.data)} rowKey={(movement) => movement.id}
                isLoading={movementsQuery.isPending} error={movementsQuery.error} onRetry={() => void movementsQuery.refetch()}
                emptyText="No movements yet." caption="Movement history" />
            </section>
            {canEdit ? (
              <section className="card compact" aria-label="Record a movement">
                <h2 className="section-title">Record a movement</h2>
                <MovementForm materials={[material]} presetCode={material.code} />
              </section>
            ) : null}
          </div>
        </div>
      )}
    </QueryState>
  );
}
