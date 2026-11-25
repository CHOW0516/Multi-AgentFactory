import type { PageRoute } from "../../shell/routes";
import { ApprovalDetailPage } from "./ApprovalDetailPage";

const route: PageRoute = {
  path: "/approvals/:approvalId", label: "Approval", icon: "approvals", roles: ["manager"], order: 21,
  element: <ApprovalDetailPage />, showInSidebar: false,
};
export default route;
