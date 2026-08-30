import type { WorkbenchAgentServerAdapter } from "@workbench/agent-runtime-server/adapter";

import { getWorkspaceStore } from "../workspaces/workspace-registry";
import {
  createPiSessionHistoryService,
  type PiSessionHistoryService,
} from "./pi-session-history-service";
import {
  createPiSessionModelContextService,
  type PiSessionModelContextService,
} from "./pi-session-model-context-service";
import { createPiScratchSessionStore } from "./pi-scratch-session-store";
import { SessionRpcService, type SessionRpcWorkspaceStore } from "./session-rpc-service";

type PiSessionAgentPorts = Pick<WorkbenchAgentServerAdapter, "execution" | "threads">;

export interface PiSessionProtocolFacadeOptions {
  /** The application-installed Agent Runtime implementation. */
  readonly agent: PiSessionAgentPorts;
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
  | "scratchCreate"
  | "scratchRelease"
  | "scratchPromote"
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
  options: PiSessionProtocolFacadeOptions,
): PiSessionProtocolFacade {
  return new SessionRpcService({
    workspaceStore: resolvingWorkspaceStore(options.resolveWorkspaceStore ?? getWorkspaceStore),
    execution: options.agent.execution,
    threads: options.agent.threads,
    history: options.history ?? createPiSessionHistoryService(),
    modelContext: options.modelContext ?? createPiSessionModelContextService(),
    scratch: createPiScratchSessionStore(),
    ...(options.defaultCwd === undefined ? {} : { defaultCwd: options.defaultCwd }),
  });
}
