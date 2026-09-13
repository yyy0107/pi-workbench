import { AgentServerError } from "../lib/agent-server-error";
import type { WorkbenchAgentCommand } from "@workbench/agent-runtime-contracts/commands";

export type AgentCommandCatalogTarget =
  | Readonly<{ kind: "thread"; threadId: string }>
  | Readonly<{ kind: "user" }>
  | Readonly<{ kind: "project"; workspaceId: string }>;

export type AgentCommandCatalogErrorCode = "thread-not-found" | "internal";

/** Stable catalog failure emitted before protocol-specific error projection. */
export class AgentCommandCatalogError extends AgentServerError<AgentCommandCatalogErrorCode> {
  constructor(code: AgentCommandCatalogErrorCode, message: string, options?: ErrorOptions) {
    super("AgentCommandCatalogError", code, message, options);
  }
}

/** Runtime-neutral server capability for Composer-visible Agent commands. */
export interface AgentCommandCatalogPort {
  getCatalog(target: AgentCommandCatalogTarget): Promise<readonly WorkbenchAgentCommand[]>;
}
