import type { WorkbenchAgentServerInstallation } from "@workbench/agent-runtime-server/installation";
import { PI_AGENT_RUNTIME_DESCRIPTOR } from "@workbench/agent-runtime-pi-shared/descriptor";

import {
  createPiAgentServerAdapter,
  type PiAgentServerAdapterDependencies,
} from "./pi-agent-server-adapter";
import { bindPiAgentHostBindings, type PiAgentHostBindings } from "./pi-agent-host-bindings";

export interface PiAgentServerInstallationOptions extends PiAgentServerAdapterDependencies {
  readonly host?: PiAgentHostBindings;
}

/** Bind Pi's server adapter dependencies to the shared installation boundary. */
export function createPiAgentServerInstallation(
  options: PiAgentServerInstallationOptions = {},
): WorkbenchAgentServerInstallation {
  const { host, ...dependencies } = options;
  if (host) bindPiAgentHostBindings(host);
  return {
    descriptor: PI_AGENT_RUNTIME_DESCRIPTOR,
    createAdapter: () => createPiAgentServerAdapter(dependencies),
  };
}
