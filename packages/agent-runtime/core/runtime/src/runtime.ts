import type {
  ComposerSubmission,
  ConversationNode,
  ConversationSnapshot,
} from "@workbench/agent-runtime-contracts/conversation";

import type { HostObservable } from "./observable";
import type {
  CreateThreadOptions,
  CurrentSessionSnapshot,
  ThreadListSnapshot,
} from "./thread-manager";

export interface ConversationActions {
  send(input: ComposerSubmission): Promise<void>;
  cancel(): Promise<void>;
  queue(input: ComposerSubmission): Promise<void>;
  steer(input: ComposerSubmission): Promise<void>;
  retry(nodeKey: string): Promise<void>;
  edit(nodeKey: string, input: ComposerSubmission): Promise<void>;
  fork(nodeKey: string): Promise<string>;
  loadOlder(): Promise<void>;
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
  session(id: string): ConversationSession | undefined;
  createThread(options?: CreateThreadOptions): Promise<string>;
  switchToThread(id: string): void;
  switchToNewThread(): void;
}
