import { lazy } from "react";
import type { PageRoute } from "../../shell/routes";
const OrdersPage = lazy(() => import("./OrdersPage").then((module) => ({ default: module.OrdersPage })));

const route: PageRoute = {
  path: "/orders", label: "Orders", icon: "orders", roles: ["manager", "sales", "planner"], order: 30, element: <OrdersPage />,
};
export default route;
