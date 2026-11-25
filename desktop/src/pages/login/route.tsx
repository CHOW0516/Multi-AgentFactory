import type { PageRoute } from "../../shell/routes";
import { LoginPage } from "./LoginPage";

const route: PageRoute = {
  path: "/login", label: "Log in", icon: "settings", roles: [], order: 0, element: <LoginPage />,
  showInSidebar: false, public: true,
};
export default route;
