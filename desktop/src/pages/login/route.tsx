import { lazy } from "react";
import type { PageRoute } from "../../shell/routes";
const LoginPage = lazy(() => import("./LoginPage").then((module) => ({ default: module.LoginPage })));

const route: PageRoute = {
  path: "/login", label: "Log in", icon: "settings", roles: [], order: 0, element: <LoginPage />,
  showInSidebar: false, public: true,
};
export default route;
