import type { WorkbenchAgentServerAdapter } from "@/runtime/server/agent-runtime-adapter";
import type { AgentCommandCatalogPort } from "@/runtime/server/agent-command-catalog-port";
import type { AgentExecutionPort } from "@/runtime/server/agent-execution-port";
import type { AgentThreadStorePort } from "@/runtime/server/agent-thread-store-port";
import { PI_AGENT_RUNTIME_DESCRIPTOR } from "@/runtime/pi/descriptor";

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
