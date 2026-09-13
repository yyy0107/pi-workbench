import type {
  ReadManagedFileAttachmentRequest,
  ReadManagedFileAttachmentResult,
  ReadPastedTextAttachmentRequest,
  ReadPastedTextAttachmentResult,
} from "@workbench/agent-runtime-contracts/composer-attachments";
import type {
  ComposerAttachment,
  ComposerQueueItem,
  ComposerSubmission,
  ConversationNode,
  ConversationSnapshot,
} from "@workbench/agent-runtime-contracts/conversation";

import type { HostObservable } from "./observable";
import type {
  CreateThreadOptions,
  CurrentSessionSnapshot,
  ThreadListActions,
  ThreadListSnapshot,
} from "./thread-manager";

export interface ConversationActions {
  /** Update only submit-relevant draft text; selection and IME state remain editor-owned. */
  setComposerText(text: string): void;
  addComposerAttachment(attachment: ComposerAttachment): Promise<void>;
  addPastedTextAttachment(text: string): Promise<void>;
  retryPastedTextAttachment(key: string): Promise<void>;
  readPastedTextAttachment(
    input: ReadPastedTextAttachmentRequest,
  ): Promise<ReadPastedTextAttachmentResult>;
  readManagedFileAttachment(
    input: ReadManagedFileAttachmentRequest,
  ): Promise<ReadManagedFileAttachmentResult>;
  removeComposerAttachment(key: string): void;
  dismissComposerError(): void;
  send(input: ComposerSubmission): Promise<void>;
  cancel(): Promise<void>;
  queue(input: ComposerSubmission): Promise<void>;
  steer(input: ComposerSubmission): Promise<void>;
  retry(nodeKey: string): Promise<void>;
  edit(nodeKey: string, input: ComposerSubmission): Promise<void>;
  fork(nodeKey: string): Promise<string>;
  selectBranch(nodeKey: string): Promise<void>;
  editQueueItem(key: string): ComposerQueueItem | undefined;
  mutateQueueItem(
    key: string,
    mutation:
      | { readonly kind: "remove" }
      | { readonly kind: "steer" }
      | { readonly kind: "move"; readonly beforeKey?: string; readonly afterKey?: string },
  ): void;
  setQueuePaused(paused: boolean): void;
  loadOlder(): Promise<void>;
  resume(checkpointId: string, expectedStateId: string): Promise<void>;
  resumeLatest(terminalMessageId: string): Promise<void>;
}

export interface ConversationSession {
  readonly id: string;
  readonly snapshot: HostObservable<ConversationSnapshot>;
  /** Method presence is the capability signal while actions migrate in vertical slices. */
  readonly actions: Readonly<Partial<ConversationActions>>;
  node(key: string): HostObservable<ConversationNode | undefined>;
}

export interface AgentRuntime {
  readonly threads: HostObservable<ThreadListSnapshot>;
  readonly current: HostObservable<CurrentSessionSnapshot>;
  readonly threadActions: Readonly<Partial<ThreadListActions>>;
  session(id: string): ConversationSession | undefined;
  createThread(options?: CreateThreadOptions): Promise<string>;
  /** Create or restore and select a local draft without allocating a remote conversation. */
  createDraft(options?: CreateThreadOptions): string;
  switchToThread(id: string): void;
  switchToNewThread(): void;
}
