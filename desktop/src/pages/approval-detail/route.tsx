import { lazy } from "react";
import type { PageRoute } from "../../shell/routes";
const ApprovalDetailPage = lazy(() => import("./ApprovalDetailPage").then((module) => ({ default: module.ApprovalDetailPage })));

const route: PageRoute = {
  path: "/approvals/:approvalId", label: "Approval", icon: "approvals", roles: ["manager"], order: 21,
  element: <ApprovalDetailPage />, showInSidebar: false,
};
export default route;
