import { lazy } from "react";
import type { PageRoute } from "../../shell/routes";
const SettingsPage = lazy(() => import("./SettingsPage").then((module) => ({ default: module.SettingsPage })));

const route: PageRoute = {
  path: "/settings", label: "Settings", icon: "settings", roles: ["admin"], order: 110, element: <SettingsPage />,
};
export default route;
