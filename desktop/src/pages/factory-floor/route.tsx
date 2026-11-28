import { lazy } from "react";
import { USE_MOCKS } from "../../api/client";
import type { PageRoute } from "../../shell/routes";
import { installFloorMocks } from "./mocks";
const FactoryFloor = lazy(() => import("./FactoryFloor").then((module) => ({ default: module.FactoryFloor })));

if (USE_MOCKS) installFloorMocks();

export default {
  path: "/", label: "Factory floor", icon: "factory", roles: [], order: 10, element: <FactoryFloor />,
} satisfies PageRoute;
