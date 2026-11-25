import type { PageRoute } from "../../shell/routes";
import { ApprovalsPage } from "./ApprovalsPage";

const route: PageRoute = {
  path: "/approvals", label: "Approvals", icon: "approvals", roles: ["manager"], order: 20, element: <ApprovalsPage />,
};
export default route;
