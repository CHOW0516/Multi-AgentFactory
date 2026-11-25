import type { PageRoute } from "../../shell/routes";
import { DashboardsPage } from "./DashboardsPage";

const route: PageRoute = {
  path: "/dashboards", label: "Dashboards", icon: "dashboards", roles: ["manager", "planner"], order: 70, element: <DashboardsPage />,
};
export default route;
