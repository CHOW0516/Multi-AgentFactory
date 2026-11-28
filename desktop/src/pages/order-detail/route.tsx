import { lazy } from "react";
import type { PageRoute } from "../../shell/routes";
const OrderDetailPage = lazy(() => import("./OrderDetailPage").then((module) => ({ default: module.OrderDetailPage })));

const route: PageRoute = {
  path: "/orders/:orderId", label: "Order", icon: "orders", roles: ["manager", "sales", "planner"], order: 31,
  element: <OrderDetailPage />, showInSidebar: false,
};
export default route;
