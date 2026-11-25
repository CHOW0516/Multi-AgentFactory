import type { PageRoute } from "../../shell/routes";
import { SettingsPage } from "./SettingsPage";

const route: PageRoute = {
  path: "/settings", label: "Settings", icon: "settings", roles: ["admin"], order: 110, element: <SettingsPage />,
};
export default route;
