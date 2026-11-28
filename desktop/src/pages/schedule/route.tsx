import { lazy } from "react";
import type { PageRoute } from "../../shell/routes";
const SchedulePage = lazy(() => import("./SchedulePage").then((module) => ({ default: module.SchedulePage })));

const route: PageRoute = {
  path: "/schedule", label: "Schedule", icon: "schedule", roles: ["manager", "planner"], order: 40, element: <SchedulePage />,
};
export default route;
