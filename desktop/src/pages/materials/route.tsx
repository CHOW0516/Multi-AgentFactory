import { lazy } from "react";
import type { PageRoute } from "../../shell/routes";
const MaterialsPage = lazy(() => import("./MaterialsPage").then((module) => ({ default: module.MaterialsPage })));

const route: PageRoute = {
  path: "/materials", label: "Materials", icon: "materials", roles: ["manager", "planner", "store"], order: 50, element: <MaterialsPage />,
};
export default route;
