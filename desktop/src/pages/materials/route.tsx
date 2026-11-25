import type { PageRoute } from "../../shell/routes";
import { MaterialsPage } from "./MaterialsPage";

const route: PageRoute = {
  path: "/materials", label: "Materials", icon: "materials", roles: ["manager", "planner", "store"], order: 50, element: <MaterialsPage />,
};
export default route;
