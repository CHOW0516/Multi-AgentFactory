import type { PageRoute } from "../../shell/routes";
import { OrdersPage } from "./OrdersPage";

const route: PageRoute = {
  path: "/orders", label: "Orders", icon: "orders", roles: ["manager", "sales", "planner"], order: 30, element: <OrdersPage />,
};
export default route;
