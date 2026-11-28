import { lazy } from "react";
import type { PageRoute } from "../../shell/routes";
const QualityPage = lazy(() => import("./QualityPage").then((module) => ({ default: module.QualityPage })));

const route: PageRoute = {
  path: "/quality", label: "Quality", icon: "quality", roles: ["manager", "qc"], order: 90, element: <QualityPage />,
};
export default route;
