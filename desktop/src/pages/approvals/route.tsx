import { lazy } from "react";
import type { PageRoute } from "../../shell/routes";
const ApprovalsPage = lazy(() => import("./ApprovalsPage").then((module) => ({ default: module.ApprovalsPage })));

const route: PageRoute = {
  path: "/approvals", label: "Approvals", icon: "approvals", roles: ["manager"], order: 20, element: <ApprovalsPage />,
};
export default route;
