import type { WorkbenchAgentServerAdapter } from "@workbench/agent-runtime-server/adapter";
import type { AgentCommandCatalogPort } from "@workbench/agent-runtime-server/commands";
import type { AgentExecutionPort } from "@workbench/agent-runtime-server/execution";
import type { AgentThreadStorePort } from "@workbench/agent-runtime-server/threads";
import { PI_AGENT_RUNTIME_DESCRIPTOR } from "@workbench/agent-runtime-pi-shared/descriptor";

import { CommandService } from "../commands/command-service";
import { createPiAgentExecutionAdapter } from "./pi-agent-execution-adapter";
import { createPiAgentThreadStoreAdapter } from "./pi-agent-thread-store-adapter";

export interface PiAgentServerAdapterDependencies {
  readonly commands?: AgentCommandCatalogPort;
  readonly execution?: AgentExecutionPort;
  readonly threads?: AgentThreadStorePort;
}

/** Create the only currently installed Workbench Agent server implementation. */
export function createPiAgentServerAdapter(
  dependencies: PiAgentServerAdapterDependencies = {},
): WorkbenchAgentServerAdapter {
  return {
    id: PI_AGENT_RUNTIME_DESCRIPTOR.id,
    commands: dependencies.commands ?? new CommandService(),
    execution: dependencies.execution ?? createPiAgentExecutionAdapter(),
    threads: dependencies.threads ?? createPiAgentThreadStoreAdapter(),
  };
}
