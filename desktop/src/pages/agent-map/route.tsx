import { USE_MOCKS } from "../../api/client";
import type { PageRoute } from "../../shell/routes";
import { AgentMap } from "./AgentMap";
import { installAgentMocks } from "./mocks";

if (USE_MOCKS) installAgentMocks();

export default {
  path: "/agent-map", label: "Agent map", icon: "agents", roles: ["manager", "admin", "planner"], order: 80, element: <AgentMap />,
} satisfies PageRoute;
