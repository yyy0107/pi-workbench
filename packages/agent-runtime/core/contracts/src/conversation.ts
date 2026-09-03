import type { ComposerJsonValue } from "@workbench/contracts/composer";

export type { ComposerSubmission } from "@workbench/contracts/composer";

export type ConversationData = ComposerJsonValue;

/** Backend-neutral failure safe to expose to Workbench conversation surfaces. */
export interface ConversationError {
  readonly code: string;
  readonly message: string;
  readonly recoverable?: boolean;
}

interface MessageBlockBase {
  /** Stable within its owning conversation node. */
  readonly key: string;
}

export interface TextBlock extends MessageBlockBase {
  readonly kind: "text";
  readonly text: string;
}

export interface ReasoningBlock extends MessageBlockBase {
  readonly kind: "reasoning";
  readonly text: string;
}

export type ToolCallStatus = "running" | "complete" | "incomplete" | "requires-action" | "error";

export interface ToolCallBlock extends MessageBlockBase {
  readonly kind: "tool-call";
  readonly callId: string;
  readonly toolName: string;
  /** Verbatim input remains useful while the JSON document is incomplete. */
  readonly argumentsText: string;
  readonly status: ToolCallStatus;
  readonly result?: ConversationData;
  readonly error?: ConversationError;
}

export interface DataBlock extends MessageBlockBase {
  readonly kind: "data";
  readonly name: string;
  readonly data: ConversationData;
}

export interface FileBlock extends MessageBlockBase {
  readonly kind: "file";
  readonly name: string;
  readonly source: string;
  readonly mediaType?: string;
}

export interface SourceBlock extends MessageBlockBase {
  readonly kind: "source";
  readonly url: string;
  readonly title?: string;
}

export interface ErrorBlock extends MessageBlockBase {
  readonly kind: "error";
  readonly error: ConversationError;
}

export type MessageBlock =
  | TextBlock
  | ReasoningBlock
  | ToolCallBlock
  | DataBlock
  | FileBlock
  | SourceBlock
  | ErrorBlock;

interface ConversationNodeBase {
  /** Adapter-provided stable identity; array positions are never identities. */
  readonly key: string;
  /** Unix epoch milliseconds when the source provides a timestamp. */
  readonly createdAt?: number;
}

export interface UserMessageNode extends ConversationNodeBase {
  readonly kind: "user";
  readonly blocks: readonly MessageBlock[];
}

export type AssistantMessageStatus = "running" | "complete" | "incomplete" | "error";

export interface AssistantMessageNode extends ConversationNodeBase {
  readonly kind: "assistant";
  readonly blocks: readonly MessageBlock[];
  readonly status: AssistantMessageStatus;
}

export interface SystemNode extends ConversationNodeBase {
  readonly kind: "system";
  readonly blocks: readonly MessageBlock[];
}

export interface CommandNode extends ConversationNodeBase {
  readonly kind: "command";
  readonly name: string;
  readonly input?: string;
  readonly output?: string;
  readonly status: "running" | "complete" | "error";
}

export interface CompactionNode extends ConversationNodeBase {
  readonly kind: "compaction";
  readonly summary?: string;
}

export interface ErrorNode extends ConversationNodeBase {
  readonly kind: "error";
  readonly error: ConversationError;
}

export type ConversationNode =
  | UserMessageNode
  | AssistantMessageNode
  | SystemNode
  | CommandNode
  | CompactionNode
  | ErrorNode;

export type ComposerMode = "send" | "queue" | "steer";
export type ComposerPhase = "idle" | "submitting" | "error";

export interface ComposerAttachment {
  readonly key: string;
  readonly name: string;
  readonly source: string;
  readonly mediaType?: string;
}

/** Submit-relevant per-session draft state; editor selection and IME state stay in React. */
export interface ComposerSnapshot {
  readonly text: string;
  readonly attachments: readonly ComposerAttachment[];
  readonly mode: ComposerMode;
  readonly phase: ComposerPhase;
  readonly error?: ConversationError;
}

export interface ConversationSnapshot {
  readonly sessionId: string;
  readonly nodeKeys: readonly string[];
  readonly isLoading: boolean;
  readonly isRunning: boolean;
  readonly hasMore: boolean;
  readonly composer: ComposerSnapshot;
  readonly error?: ConversationError;
}
