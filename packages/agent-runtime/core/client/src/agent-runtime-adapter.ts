import type {
  AppendMessage,
  AssistantRuntime,
  QueueItemState,
  RemoteThreadListAdapter,
} from "@assistant-ui/react";

import type { WorkbenchAgentCommand } from "@workbench/agent-runtime-contracts/commands";
import type { AutomationSessionOrigin } from "@workbench/automation-contracts";
import type { ExecutionSessionOrigin } from "@workbench/execution-contracts";

/** Workbench-owned workspace identity projected by an Agent Runtime implementation. */
export interface WorkbenchAgentWorkspace {
  readonly id: string;
  readonly name?: string;
  readonly rootPath?: string;
  readonly pinned?: boolean;
}

/**
 * Live presentation state that assistant-ui's mounted thread-list item cannot represent alone.
 *
 * This is intentionally not a second message or conversation model. It only covers backend-owned
 * metadata needed by Workbench chrome, including activity for background threads.
 */
export interface WorkbenchAgentThreadSnapshot {
  readonly title?: string;
  readonly lastMessageAt?: Date;
  /** ISO-8601 timestamp used as the stable fallback for manual sidebar ordering. */
  readonly createdAt?: string;
  /** Durable provenance for conversations created by an Automation task. */
  readonly automationOrigin?: AutomationSessionOrigin;
  /** Durable workflow provenance for conversations created by an Execution run. */
  readonly executionOrigin?: ExecutionSessionOrigin;
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

/**
 * Stable Workbench seam between assistant-ui and an agent runtime implementation.
 *
 * Implementations own their transport, message projection, error mapping, queues, and backend
 * lifecycle. The Workbench assistant-ui layer only coordinates the shared thread-list runtime.
 */
export interface WorkbenchAgentRuntimeAdapter {
  /** Stable implementation identifier such as `pi`, `codex`, or `claude-code`. */
  readonly id: string;
  /** Backend-owned persistence and mutation adapter for Workbench conversations. */
  readonly threadListAdapter: RemoteThreadListAdapter;
  /** Backend-owned hook that exposes the active conversation as an assistant-ui Runtime. */
  readonly useThreadRuntime: () => AssistantRuntime;
  /** Backend-owned hook that projects commands available to the active conversation or draft. */
  readonly useCommandCatalog: () => readonly WorkbenchAgentCommand[];
  /** Optional live metadata and mutations consumed by Workbench thread chrome. */
  readonly threadStore?: WorkbenchAgentThreadStore;
  /** Optional workspace-file capability consumed by generic Composer mentions. */
  readonly workspaceFiles?: WorkbenchWorkspaceFileSearchPort;
  /** Monotonic revision for backend-owned membership, archive status, or ordering changes. */
  getThreadListRevision(): number;
  /** Subscribe to changes of `getThreadListRevision()`. */
  subscribeThreadList(listener: () => void): () => void;
}

/** Backend-neutral Composer failures that Workbench can render and recover from. */
export type WorkbenchAgentComposerSendError =
  | "model-attachment-unsupported"
  | "attachment-invalid"
  | "attachment-too-large"
  | "too-many-attachments";

export interface WorkbenchAgentRunTiming {
  /** Unix timestamp supplied by the agent host for the beginning of the active run. */
  readonly startedAt: number;
  /** Server-authoritative elapsed duration at the time this snapshot was observed. */
  readonly elapsedMs: number;
  /** Monotonic browser timestamp captured when the client received the snapshot. */
  readonly observedAt: number;
}

export interface WorkbenchAgentAutoRetry {
  readonly attempt: number;
  readonly maxAttempts: number;
}

/**
 * Backend-neutral subset required by the Workbench's interrupted-run recovery UI.
 *
 * Implementations may retain richer native checkpoint data internally. These identifiers are
 * opaque to the Workbench and are only echoed back to the implementation that produced them.
 */
export interface WorkbenchAgentResumeCheckpoint {
  readonly checkpointId: string;
  readonly terminalMessageId: string;
  /** Optimistic-concurrency token for the native state this checkpoint resumes from. */
  readonly expectedStateId: string;
  readonly capability: "ready" | "blocked" | "confirmation-required";
}

export interface WorkbenchAgentQueueExtras {
  readonly paused: boolean;
  readonly steeringIds: readonly string[];
  readonly rejectedDraft?: {
    readonly revision: number;
    readonly message: AppendMessage;
  };
  beginEdit(id: string): QueueItemState | undefined;
  clearRejectedDraft(revision: number): void;
  setPaused(paused: boolean): void;
}

export interface WorkbenchAgentRunExtras {
  readonly timing?: WorkbenchAgentRunTiming;
  readonly autoRetry?: WorkbenchAgentAutoRetry;
  readonly resumeCheckpoint?: WorkbenchAgentResumeCheckpoint;
  resume?(checkpointId: string, expectedStateId: string): Promise<void>;
  resumeLatest?(terminalMessageId: string): Promise<void>;
}

export interface WorkbenchAgentComposerExtras {
  readonly error?: WorkbenchAgentComposerSendError;
  clearError(): void;
}

export interface WorkbenchAgentThreadExtras {
  readonly workspace?: WorkbenchAgentWorkspace;
}

/** Optional implementation capabilities projected through assistant-ui thread extras. */
export interface WorkbenchAgentRuntimeExtras {
  readonly agentThread?: WorkbenchAgentThreadExtras;
  readonly agentQueue?: WorkbenchAgentQueueExtras;
  readonly agentRun?: WorkbenchAgentRunExtras;
  readonly agentComposer?: WorkbenchAgentComposerExtras;
}
