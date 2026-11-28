import { lazy } from "react";
import type { PageRoute } from "../../shell/routes";
const HistoryPage = lazy(() => import("./HistoryPage").then((module) => ({ default: module.HistoryPage })));

const route: PageRoute = {
  path: "/history", label: "History", icon: "history", roles: ["manager"], order: 100, element: <HistoryPage />,
};
export default route;
