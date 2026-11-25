import type { PageRoute } from "../../shell/routes";
import { HistoryPage } from "./HistoryPage";

const route: PageRoute = {
  path: "/history", label: "History", icon: "history", roles: ["manager"], order: 100, element: <HistoryPage />,
};
export default route;
