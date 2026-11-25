import type { PageRoute } from "../../shell/routes";
import { QualityPage } from "./QualityPage";

const route: PageRoute = {
  path: "/quality", label: "Quality", icon: "quality", roles: ["manager", "qc"], order: 90, element: <QualityPage />,
};
export default route;
