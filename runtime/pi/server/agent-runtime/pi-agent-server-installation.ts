import type { WorkbenchAgentServerInstallation } from "@/runtime/server/agent-runtime-installation";
import { PI_AGENT_RUNTIME_DESCRIPTOR } from "@/runtime/pi/descriptor";

import {
  createPiAgentServerAdapter,
  type PiAgentServerAdapterDependencies,
} from "./pi-agent-server-adapter";

/** Bind Pi's server adapter dependencies to the shared installation boundary. */
export function createPiAgentServerInstallation(
  dependencies: PiAgentServerAdapterDependencies = {},
): WorkbenchAgentServerInstallation {
  return {
    descriptor: PI_AGENT_RUNTIME_DESCRIPTOR,
    createAdapter: () => createPiAgentServerAdapter(dependencies),
  };
}
