import { ApiError, registerMock } from "../../api/client";
import type { CycleCountIn, StockMovementIn, StockMovementOut } from "../../api/types";
import { holds, materials, movements, purchaseRequests, users } from "../../components/mock-data";

function refreshTotals(materialId: string) {
  const material = materials.find((candidate) => candidate.id === materialId);
  if (!material) return;
  material.available = String(Number(material.stock) - Number(material.held));
  material.warnings = material.warnings.filter((warning) => warning !== "Below minimum stock");
  if (Number(material.available) < Number(material.min_stock)) material.warnings.unshift("Below minimum stock");
}

registerMock("GET", "/materials", () => materials);
registerMock("GET", "/materials/:materialId", ({ params }) => {
  const material = materials.find((candidate) => candidate.id === params.materialId);
  if (!material) throw new ApiError(404, "Material not found");
  return material;
});
registerMock("GET", "/stock-movements", ({ query }) => {
  const materialId = query.get("material_id");
  return movements.filter((movement) => !materialId || movement.material_id === materialId)
    .sort((first, second) => second.created_at.localeCompare(first.created_at));
});
registerMock("POST", "/stock-movements", ({ body }) => {
  const input = body as StockMovementIn;
  const material = materials.find((candidate) => candidate.id === input.material_id);
  if (!material) throw new ApiError(404, "Material not found");
  const movement: StockMovementOut = {
    id: `0e000000-0000-4000-8000-${String(movements.length + 1).padStart(12, "0")}`, material_id: material.id,
    quantity: String(input.quantity), movement_type: input.movement_type, reference: input.reference ?? null, reason: input.reason ?? null,
    order_id: input.order_id ?? null, user_id: users[5].id, created_at: new Date().toISOString(),
  };
  movements.push(movement);
  material.stock = String(Number(material.stock) + Number(input.quantity));
  refreshTotals(material.id);
  return movement;
});
registerMock("GET", "/holds", () => holds);
registerMock("GET", "/purchase-requests", () => purchaseRequests);
registerMock("POST", "/cycle-counts", ({ body }) => {
  const input = body as CycleCountIn;
  const material = materials.find((candidate) => candidate.id === input.material_id);
  if (!material) throw new ApiError(404, "Material not found");
  material.stock = String(input.counted_quantity);
  material.last_counted_at = new Date().toISOString();
  material.warnings = material.warnings.filter((warning) => !warning.startsWith("Not counted"));
  refreshTotals(material.id);
  return material;
});
