import { lazy } from "react";
import type { PageRoute } from "../../shell/routes";
const LineSimulatorPage = lazy(() => import("./LineSimulatorPage").then((module) => ({ default: module.LineSimulatorPage })));

const route: PageRoute = {
  path: "/line-simulator", label: "Line simulator", icon: "line", roles: ["manager", "planner"], order: 75, element: <LineSimulatorPage />,
};
export default route;
