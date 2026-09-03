import type { ConversationError } from "@workbench/agent-runtime-contracts/conversation";

export interface ThreadWorkspace {
  readonly id: string;
  readonly name?: string;
  readonly rootPath?: string;
}

/** Runtime-neutral row used by the Workbench thread catalog. */
export interface ThreadListItem {
  readonly threadId: string;
  readonly title?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly isArchived: boolean;
  readonly isPinned: boolean;
  readonly isRunning: boolean;
  readonly isWaitingForInput: boolean;
  readonly hasUnreadCompletion: boolean;
  readonly workspace?: ThreadWorkspace;
}

export interface ThreadListSnapshot {
  readonly threads: readonly ThreadListItem[];
  readonly isLoading: boolean;
  readonly error?: ConversationError;
}

export interface CurrentSessionSnapshot {
  readonly sessionId: string | undefined;
  readonly isNewThread: boolean;
}

export interface CreateThreadOptions {
  readonly workspaceId?: string;
  readonly preset?: string;
}
