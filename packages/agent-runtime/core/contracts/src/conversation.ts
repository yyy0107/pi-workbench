import type {
  ManagedFileAttachment,
  ManagedImageAttachment,
  PastedTextAttachment,
} from "@workbench/contracts/composer";
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

export interface MessageBlockTiming {
  readonly startedAt: number;
  readonly completedAt?: number;
}

export interface TextBlock extends MessageBlockBase {
  readonly kind: "text";
  readonly text: string;
}

export interface ReasoningBlock extends MessageBlockBase {
  readonly kind: "reasoning";
  readonly text: string;
  readonly status?: "running" | "complete" | "incomplete";
  readonly timing?: MessageBlockTiming;
}

export type ToolCallStatus = "running" | "complete" | "incomplete" | "requires-action" | "error";
export type ToolCallIncompleteReason =
  | "cancelled"
  | "length"
  | "content-filter"
  | "other"
  | "error"
  | "tool-calls";

export interface ToolCallBlock extends MessageBlockBase {
  readonly kind: "tool-call";
  readonly callId: string;
  readonly toolName: string;
  /** Best-effort parsed arguments; partial while the call is streaming. */
  readonly arguments?: ConversationData;
  /** Verbatim input remains useful while the JSON document is incomplete. */
  readonly argumentsText: string;
  readonly status: ToolCallStatus;
  readonly incompleteReason?: ToolCallIncompleteReason;
  readonly result?: ConversationData;
  readonly error?: ConversationError;
  readonly timing?: MessageBlockTiming;
  readonly parallelGroup?: {
    readonly key: string;
    readonly size: number;
  };
}

export interface DataBlock extends MessageBlockBase {
  readonly kind: "data";
  readonly name: string;
  readonly data: ConversationData;
}

export interface FileBlock extends MessageBlockBase {
  readonly textAttachment?: PastedTextAttachment;
  readonly fileAttachment?: ManagedFileAttachment;
  /** @deprecated Read-only compatibility for image-only projections. */
  readonly imageAttachment?: ManagedImageAttachment;
  readonly kind: "file";
  readonly name: string;
  readonly source: string;
  readonly mediaType?: string;
  readonly sourceType?: "url" | "id";
  /** Optional per-file generation state, independent of the enclosing assistant turn. */
  readonly status?: "running" | "complete" | "incomplete" | "error";
}

export interface SourceBlock extends MessageBlockBase {
  readonly kind: "source";
  readonly url?: string;
  readonly title?: string;
  readonly filename?: string;
  readonly mediaType?: string;
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
  /** Backend-neutral presentation data used by message chrome and extension Slots. */
  readonly presentation?: ConversationNodePresentation;
}

export interface ConversationNodeBranch {
  /** Zero-based position within the alternatives at this conversation boundary. */
  readonly index: number;
  readonly count: number;
  /** Opaque node keys echoed to `selectBranch`; the UI never interprets them. */
  readonly previousKey?: string;
  readonly nextKey?: string;
}

export interface ConversationNodePresentation {
  /** JSON-safe custom metadata retained for existing Workbench presentation readers. */
  readonly custom?: Readonly<Record<string, ConversationData>>;
  readonly isOptimistic?: boolean;
  readonly timing?: {
    readonly streamStartTime?: number;
    readonly firstTokenTime?: number;
    readonly totalStreamTime?: number;
    readonly tokenCount?: number;
    readonly tokensPerSecond?: number;
    readonly totalChunks?: number;
    readonly toolCallCount?: number;
  };
  readonly branch?: ConversationNodeBranch;
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

export interface InlineComposerAttachment {
  readonly kind?: "inline";
  readonly key: string;
  readonly name: string;
  readonly source: string;
  readonly mediaType?: string;
}

export type ManagedFileComposerAttachment = {
  readonly kind: "managed-file";
  readonly key: string;
  readonly name: string;
  readonly source: string;
  readonly mediaType: string;
} & (
  | { readonly status: "saving" | "error"; readonly error?: string }
  | { readonly status: "ready"; readonly attachment: ManagedFileAttachment }
);

export type PastedTextComposerAttachment = {
  readonly kind: "pasted-text";
  readonly key: string;
  readonly name: string;
  readonly mediaType: "text/plain";
} & (
  | { readonly status: "saving" | "error"; readonly text: string; readonly error?: string }
  | { readonly status: "ready"; readonly attachment: PastedTextAttachment }
);

export type ComposerAttachment =
  | InlineComposerAttachment
  | ManagedFileComposerAttachment
  | PastedTextComposerAttachment;

export interface ComposerQueueItem {
  readonly key: string;
  readonly text: string;
  readonly attachments: readonly ComposerAttachment[];
}

export interface ComposerQueueSnapshot {
  readonly items: readonly ComposerQueueItem[];
  readonly paused: boolean;
}

/** Submit-relevant per-session draft state; editor selection and IME state stay in React. */
export interface ComposerSnapshot {
  readonly text: string;
  readonly attachments: readonly ComposerAttachment[];
  readonly mode: ComposerMode;
  readonly phase: ComposerPhase;
  readonly error?: ConversationError;
  readonly queue?: ComposerQueueSnapshot;
}

export interface ConversationRunTiming {
  /** Unix timestamp supplied by the host for the beginning of the active run. */
  readonly startedAt: number;
  /** Server-authoritative elapsed duration when the client observed this snapshot. */
  readonly elapsedMs: number;
  /** Monotonic browser timestamp captured when the client observed this snapshot. */
  readonly observedAt: number;
}

export interface ConversationAutoRetry {
  readonly attempt: number;
  readonly maxAttempts: number;
}

export interface ConversationResumeCheckpoint {
  readonly checkpointId: string;
  readonly terminalMessageId: string;
  /** Opaque concurrency token echoed to the runtime on resume. */
  readonly expectedStateId: string;
  readonly capability: "ready" | "blocked" | "confirmation-required";
}

export interface ConversationSnapshot {
  readonly sessionId: string;
  readonly nodeKeys: readonly string[];
  readonly isLoading: boolean;
  readonly isRunning: boolean;
  readonly hasMore: boolean;
  readonly composer: ComposerSnapshot;
  readonly error?: ConversationError;
  readonly runTiming?: ConversationRunTiming;
  readonly autoRetry?: ConversationAutoRetry;
  readonly resumeCheckpoint?: ConversationResumeCheckpoint;
}
