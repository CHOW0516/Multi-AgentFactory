import type { PageRoute } from "../../shell/routes";
import { LineSimulatorPage } from "./LineSimulatorPage";

const route: PageRoute = {
  path: "/line-simulator", label: "Line simulator", icon: "line", roles: ["manager", "planner"], order: 75, element: <LineSimulatorPage />,
};
export default route;
