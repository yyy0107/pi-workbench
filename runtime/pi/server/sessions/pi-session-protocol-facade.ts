import type { AgentCommandCatalogPort } from "@/runtime/server/agent-command-catalog-port";
import type { WorkbenchAgentServerAdapter } from "@/runtime/server/agent-runtime-adapter";
import { createInstalledWorkbenchAgentServerAdapter } from "@/runtime/server/agent-runtime-installation";

import { createPiAgentServerInstallation } from "../agent-runtime/pi-agent-server-installation";
import { getWorkspaceStore } from "../workspaces/workspace-registry";
import {
  createPiSessionHistoryService,
  type PiSessionHistoryService,
} from "./pi-session-history-service";
import {
  createPiSessionModelContextService,
  type PiSessionModelContextService,
} from "./pi-session-model-context-service";
import { SessionRpcService, type SessionRpcWorkspaceStore } from "./session-rpc-service";

type PiSessionAgentPorts = Pick<WorkbenchAgentServerAdapter, "execution" | "threads">;

export interface PiSessionProtocolFacadeOptions {
  /** Override the installed Agent Runtime implementation, primarily for tests. */
  readonly agent?: PiSessionAgentPorts;
  /** Reuse the transport-owned command catalog when assembling the default Pi Agent adapter. */
  readonly commands?: AgentCommandCatalogPort;
  /** Resolve lazily so a long-lived facade follows WorkspaceStore HMR replacements. */
  readonly resolveWorkspaceStore?: () => SessionRpcWorkspaceStore;
  readonly history?: PiSessionHistoryService;
  readonly modelContext?: PiSessionModelContextService;
  readonly defaultCwd?: string;
}

export type PiSessionProtocolFacade = Pick<
  SessionRpcService,
  | "list"
  | "search"
  | "create"
  | "history"
  | "regenerate"
  | "resume"
  | "selectBranch"
  | "models"
  | "selectModel"
  | "contextPolicy"
  | "updateContextPolicy"
  | "compactContext"
  | "rename"
  | "delete"
  | "fork"
  | "prompt"
  | "attachment"
  | "updateQueue"
  | "cancel"
>;

function resolvingWorkspaceStore(
  resolve: () => SessionRpcWorkspaceStore,
): SessionRpcWorkspaceStore {
  return {
    list: () => resolve().list(),
    attachSession: (workspaceId, sessionId) => resolve().attachSession(workspaceId, sessionId),
    reconcile: (sessions, options) => resolve().reconcile(sessions, options),
  };
}

/**
 * Assemble one long-lived Pi session protocol surface for a server module generation.
 *
 * The facade intentionally owns the stateful SessionRpcService instance. In particular, its
 * requested-session create coordinator must span independent HTTP requests. Replaceable process
 * dependencies stay late-bound behind resolving ports instead of forcing request-scoped service
 * reconstruction.
 */
export function createPiSessionProtocolFacade(
  options: PiSessionProtocolFacadeOptions = {},
): PiSessionProtocolFacade {
  const agent =
    options.agent ??
    createInstalledWorkbenchAgentServerAdapter(
      createPiAgentServerInstallation(
        options.commands === undefined ? {} : { commands: options.commands },
      ),
    );

  return new SessionRpcService({
    workspaceStore: resolvingWorkspaceStore(options.resolveWorkspaceStore ?? getWorkspaceStore),
    execution: agent.execution,
    threads: agent.threads,
    history: options.history ?? createPiSessionHistoryService(),
    modelContext: options.modelContext ?? createPiSessionModelContextService(),
    ...(options.defaultCwd === undefined ? {} : { defaultCwd: options.defaultCwd }),
  });
}
