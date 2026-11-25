import type { PageRoute } from "../../shell/routes";
import { MaterialDetailPage } from "./MaterialDetailPage";

const route: PageRoute = {
  path: "/materials/:materialId", label: "Material", icon: "materials", roles: ["manager", "planner", "store"], order: 51,
  element: <MaterialDetailPage />, showInSidebar: false,
};
export default route;
