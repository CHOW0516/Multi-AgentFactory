import { lazy } from "react";
import type { PageRoute } from "../../shell/routes";
const QuotationsPage = lazy(() => import("./QuotationsPage").then((module) => ({ default: module.QuotationsPage })));

const route: PageRoute = {
  path: "/quotations", label: "Quotations", icon: "quotations", roles: ["manager", "sales"], order: 60, element: <QuotationsPage />,
};
export default route;
