import type { PageRoute } from "../../shell/routes";
import { OrderDetailPage } from "./OrderDetailPage";

const route: PageRoute = {
  path: "/orders/:orderId", label: "Order", icon: "orders", roles: ["manager", "sales", "planner"], order: 31,
  element: <OrderDetailPage />, showInSidebar: false,
};
export default route;
