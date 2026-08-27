import type {
  AppendMessage,
  AssistantRuntime,
  QueueItemState,
  RemoteThreadListAdapter,
} from "@assistant-ui/react";

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
  /** Notify the shared thread-list runtime when backend membership or ordering changes. */
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

/** Optional implementation capabilities projected through assistant-ui thread extras. */
export interface WorkbenchAgentRuntimeExtras {
  readonly agentQueue?: WorkbenchAgentQueueExtras;
  readonly agentRun?: WorkbenchAgentRunExtras;
  readonly agentComposer?: WorkbenchAgentComposerExtras;
}
