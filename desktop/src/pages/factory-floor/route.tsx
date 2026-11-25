import { USE_MOCKS } from "../../api/client";
import type { PageRoute } from "../../shell/routes";
import { FactoryFloor } from "./FactoryFloor";
import { installFloorMocks } from "./mocks";

if (USE_MOCKS) installFloorMocks();

export default {
  path: "/", label: "Factory floor", icon: "factory", roles: [], order: 10, element: <FactoryFloor />,
} satisfies PageRoute;
