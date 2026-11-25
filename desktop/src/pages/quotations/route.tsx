import type { PageRoute } from "../../shell/routes";
import { QuotationsPage } from "./QuotationsPage";

const route: PageRoute = {
  path: "/quotations", label: "Quotations", icon: "quotations", roles: ["manager", "sales"], order: 60, element: <QuotationsPage />,
};
export default route;
