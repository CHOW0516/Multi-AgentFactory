import { lazy } from "react";
import type { PageRoute } from "../../shell/routes";
const DashboardsPage = lazy(() => import("./DashboardsPage").then((module) => ({ default: module.DashboardsPage })));

const route: PageRoute = {
  path: "/dashboards", label: "Dashboards", icon: "dashboards", roles: ["manager", "planner"], order: 70, element: <DashboardsPage />,
};
export default route;
