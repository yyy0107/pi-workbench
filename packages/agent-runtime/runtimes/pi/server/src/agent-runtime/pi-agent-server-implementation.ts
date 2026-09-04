import type { WorkbenchAgentServerAdapter } from "@workbench/agent-runtime-server/adapter";
import type { AgentCommandCatalogPort } from "@workbench/agent-runtime-server/commands";
import type { AgentExecutionPort } from "@workbench/agent-runtime-server/execution";
import type { AgentThreadStorePort } from "@workbench/agent-runtime-server/threads";
import { PI_AGENT_RUNTIME_DESCRIPTOR } from "@workbench/agent-runtime-pi-shared/descriptor";

import { CommandService } from "../commands/command-service";
import { createPiAgentExecution } from "./pi-agent-execution";
import { bindPiAgentHostBindings, type PiAgentHostBindings } from "./pi-agent-host-bindings";
import { createPiAgentThreadStore } from "./pi-agent-thread-store";

export interface PiAgentServerImplementationDependencies {
  readonly commands?: AgentCommandCatalogPort;
  readonly execution?: AgentExecutionPort;
  readonly host?: PiAgentHostBindings;
  readonly threads?: AgentThreadStorePort;
}

/** Create the only currently installed Workbench Agent server implementation. */
export function createPiAgentServerImplementation({
  commands,
  execution,
  host,
  threads,
}: PiAgentServerImplementationDependencies = {}): WorkbenchAgentServerAdapter {
  if (host) bindPiAgentHostBindings(host);
  return {
    id: PI_AGENT_RUNTIME_DESCRIPTOR.id,
    commands: commands ?? new CommandService(),
    execution: execution ?? createPiAgentExecution(),
    threads: threads ?? createPiAgentThreadStore(),
  };
}
