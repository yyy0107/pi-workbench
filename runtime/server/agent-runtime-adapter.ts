import type { AgentCommandCatalogPort } from "./agent-command-catalog-port";
import type { AgentExecutionPort } from "./agent-execution-port";
import type { AgentThreadStorePort } from "./agent-thread-store-port";

/** Server-side composition boundary implemented once per concrete Agent Runtime. */
export interface WorkbenchAgentServerAdapter {
  readonly id: string;
  readonly commands: AgentCommandCatalogPort;
  readonly execution: AgentExecutionPort;
  readonly threads: AgentThreadStorePort;
}
