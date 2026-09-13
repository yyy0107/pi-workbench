import type { AgentCommandCatalogPort } from "./commands";
import type { AgentExecutionPort } from "./execution";
import type { AgentThreadStorePort } from "./threads";

/** Server-side composition boundary implemented once per concrete Agent Runtime. */
export interface WorkbenchAgentServerAdapter {
  readonly id: string;
  readonly commands: AgentCommandCatalogPort;
  readonly execution: AgentExecutionPort;
  readonly threads: AgentThreadStorePort;
}
