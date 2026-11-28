import { lazy } from "react";
import { USE_MOCKS } from "../../api/client";
import type { PageRoute } from "../../shell/routes";
import { installAgentMocks } from "./mocks";
const AgentMap = lazy(() => import("./AgentMap").then((module) => ({ default: module.AgentMap })));

if (USE_MOCKS) installAgentMocks();

export default {
  path: "/agent-map", label: "Agent map", icon: "agents", roles: ["manager", "admin", "planner"], order: 80, element: <AgentMap />,
} satisfies PageRoute;
