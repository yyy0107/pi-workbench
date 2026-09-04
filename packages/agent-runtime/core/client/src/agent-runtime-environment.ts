import type { AutomationSessionOrigin } from "@workbench/automation-contracts";

/** Workbench-owned workspace identity projected by an Agent Runtime implementation. */
export interface WorkbenchAgentWorkspace {
  readonly id: string;
  readonly name?: string;
  readonly rootPath?: string;
  readonly pinned?: boolean;
}

/** Backend-owned metadata needed by Workbench chrome, including background activity. */
export interface WorkbenchAgentThreadSnapshot {
  readonly title?: string;
  readonly lastMessageAt?: Date;
  /** ISO-8601 timestamp used as the stable fallback for manual sidebar ordering. */
  readonly createdAt?: string;
  /** Durable provenance for conversations created by an Automation task. */
  readonly automationOrigin?: AutomationSessionOrigin;
  readonly isRunning: boolean;
  readonly isWaitingForInput: boolean;
  /** Whether a background completion still needs to be acknowledged by opening the thread. */
  readonly hasUnreadCompletion: boolean;
  readonly isPinned: boolean;
  readonly workspace?: WorkbenchAgentWorkspace;
}

export interface WorkbenchAgentThreadMove {
  readonly workspaceId: string;
  readonly threadId: string;
  readonly beforeThreadId?: string;
}

export interface WorkbenchAgentThreadForkRequest {
  readonly threadId: string;
  /** Opaque state token projected on the message selected as the fork boundary. */
  readonly atStateToken: string;
  readonly sourceTitle: string;
}

export interface WorkbenchWorkspaceFileSearchEntry {
  readonly relativePath: string;
}

export interface WorkbenchWorkspaceFileSearchRequest {
  readonly workspaceId: string;
  readonly query: string;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

/** Optional workspace file discovery supplied by the selected Agent Runtime implementation. */
export interface WorkbenchWorkspaceFileSearchPort {
  search(
    request: WorkbenchWorkspaceFileSearchRequest,
  ): Promise<readonly WorkbenchWorkspaceFileSearchEntry[]>;
}

/** Optional mutations supported by a concrete Agent Runtime's thread catalog. */
export interface WorkbenchAgentThreadActions {
  readonly setPinned?: (threadId: string, pinned: boolean) => Promise<void>;
  readonly moveWithinWorkspace?: (request: WorkbenchAgentThreadMove) => Promise<void>;
  readonly forkAt?: (
    request: WorkbenchAgentThreadForkRequest,
  ) => Promise<Readonly<{ threadId: string }>>;
}

/**
 * Observable projection for backend-owned thread metadata.
 *
 * Revisions are subscribed through `useSyncExternalStore`; `getSnapshot()` may therefore project a
 * fresh immutable object without becoming React's subscription identity.
 */
export interface WorkbenchAgentThreadStore {
  getRevision(threadId: string | undefined): number;
  getSnapshot(threadId: string | undefined): WorkbenchAgentThreadSnapshot;
  subscribe(threadId: string | undefined, listener: () => void): () => void;
  readonly actions?: WorkbenchAgentThreadActions;
}

/** Backend-neutral Composer failures that Workbench can render and recover from. */
export type WorkbenchAgentComposerSendError =
  | "model-attachment-unsupported"
  | "attachment-invalid"
  | "attachment-too-large"
  | "too-many-attachments";
