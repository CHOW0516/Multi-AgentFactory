import { lazy } from "react";
import type { PageRoute } from "../../shell/routes";
const MaterialDetailPage = lazy(() => import("./MaterialDetailPage").then((module) => ({ default: module.MaterialDetailPage })));

const route: PageRoute = {
  path: "/materials/:materialId", label: "Material", icon: "materials", roles: ["manager", "planner", "store"], order: 51,
  element: <MaterialDetailPage />, showInSidebar: false,
};
export default route;
