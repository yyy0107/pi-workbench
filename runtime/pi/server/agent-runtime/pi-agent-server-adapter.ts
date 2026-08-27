import type { WorkbenchAgentServerAdapter } from "@/runtime/server/agent-runtime-adapter";
import type { AgentCommandCatalogPort } from "@/runtime/server/agent-command-catalog-port";

import { CommandService } from "../commands/command-service";
import { createPiAgentExecutionAdapter } from "./pi-agent-execution-adapter";
import { createPiAgentThreadStoreAdapter } from "./pi-agent-thread-store-adapter";

export const PI_AGENT_SERVER_ADAPTER_ID = "pi";

export interface PiAgentServerAdapterDependencies {
  readonly commands?: AgentCommandCatalogPort;
}

/** Create the only currently installed Workbench Agent server implementation. */
export function createPiAgentServerAdapter(
  dependencies: PiAgentServerAdapterDependencies = {},
): WorkbenchAgentServerAdapter {
  return {
    id: PI_AGENT_SERVER_ADAPTER_ID,
    commands: dependencies.commands ?? new CommandService(),
    execution: createPiAgentExecutionAdapter(),
    threads: createPiAgentThreadStoreAdapter(),
  };
}
