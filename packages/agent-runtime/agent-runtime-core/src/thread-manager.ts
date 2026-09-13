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
  readonly lastRunFailed?: boolean;
  readonly workspace?: ThreadWorkspace;
  /** Runtime-neutral provenance used only for catalog presentation. */
  readonly origin?: { readonly kind: string };
}

export interface ThreadListSnapshot {
  readonly threads: readonly ThreadListItem[];
  readonly isLoading: boolean;
  readonly error?: ConversationError;
}

export interface CurrentSessionSnapshot {
  /** Stable in-memory Session identity; it remains unchanged during draft promotion. */
  readonly sessionId: string | undefined;
  /** Durable catalog/route identity once one exists. */
  readonly threadId?: string;
  readonly isNewThread: boolean;
}

export interface CreateThreadOptions {
  readonly workspaceId?: string;
  readonly preset?: string;
}

export interface ThreadListMove {
  readonly workspaceId: string;
  readonly threadId: string;
  readonly beforeThreadId?: string;
}

export interface ThreadListActions {
  rename(threadId: string, title: string): Promise<void>;
  archive(threadId: string): Promise<void>;
  unarchive(threadId: string): Promise<void>;
  delete(threadId: string): Promise<void>;
  setPinned(threadId: string, pinned: boolean): Promise<void>;
  moveWithinWorkspace(move: ThreadListMove): Promise<void>;
}
