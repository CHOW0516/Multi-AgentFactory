import type { PageRoute } from "../../shell/routes";
import { SchedulePage } from "./SchedulePage";

const route: PageRoute = {
  path: "/schedule", label: "Schedule", icon: "schedule", roles: ["manager", "planner"], order: 40, element: <SchedulePage />,
};
export default route;
