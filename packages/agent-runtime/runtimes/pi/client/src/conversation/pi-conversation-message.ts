import type { PastedTextAttachment } from "@workbench/contracts/composer";
/** JSON-compatible provider metadata carried by a canonical Pi conversation part. */
export type PiConversationJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly PiConversationJsonValue[]
  | { readonly [key: string]: PiConversationJsonValue };

export interface PiMessageTiming {
  readonly streamStartTime: number;
  readonly firstTokenTime?: number;
  readonly totalStreamTime?: number;
  readonly tokenCount?: number;
  readonly tokensPerSecond?: number;
  readonly totalChunks: number;
  readonly toolCallCount: number;
}

export interface PiToolCallTiming {
  readonly startedAt: number;
  readonly completedAt?: number;
}

export type PiMessagePartStatus =
  | { readonly type: "running" }
  | { readonly type: "complete" }
  | {
      readonly type: "incomplete";
      readonly reason: "cancelled" | "length" | "content-filter" | "other" | "error";
    };

export type PiMessageStatus =
  | { readonly type: "running" }
  | { readonly type: "requires-action"; readonly reason: "tool-calls" | "interrupt" }
  | { readonly type: "complete"; readonly reason: "stop" | "unknown" }
  | {
      readonly type: "incomplete";
      readonly reason: "cancelled" | "tool-calls" | "length" | "content-filter" | "other" | "error";
      readonly error?: PiConversationJsonValue;
    };

export interface PiPartProviderMetadata {
  readonly [providerName: string]: Readonly<Record<string, PiConversationJsonValue>>;
}

export interface PiTextMessagePart {
  readonly type: "text";
  readonly text: string;
  readonly status?: PiMessagePartStatus;
  readonly providerMetadata?: PiPartProviderMetadata;
  readonly parentId?: string;
}

export interface PiReasoningMessagePart {
  readonly type: "reasoning";
  readonly text: string;
  readonly status?: PiMessagePartStatus;
  readonly unstable_summary?: string;
  readonly providerMetadata?: PiPartProviderMetadata;
  readonly parentId?: string;
}

export type PiSourceMessagePart =
  | {
      readonly type: "source";
      readonly sourceType: "url";
      readonly id: string;
      readonly url: string;
      readonly title?: string;
      readonly providerMetadata?: PiPartProviderMetadata;
      readonly parentId?: string;
    }
  | {
      readonly type: "source";
      readonly sourceType: "document";
      readonly id: string;
      readonly title: string;
      readonly mediaType: string;
      readonly filename?: string;
      readonly providerMetadata?: PiPartProviderMetadata;
      readonly parentId?: string;
    };

export interface PiImageMessagePart {
  readonly type: "image";
  readonly image: string;
  readonly filename?: string;
  readonly status?: PiMessagePartStatus;
  readonly providerMetadata?: PiPartProviderMetadata;
}

export interface PiFileMessagePart {
  readonly textAttachment?: PastedTextAttachment;
  readonly type: "file";
  readonly filename?: string;
  readonly data: string;
  readonly mimeType: string;
  readonly sourceType?: "url" | "id";
  readonly providerMetadata?: PiPartProviderMetadata;
  readonly parentId?: string;
}

export interface PiAudioMessagePart {
  readonly type: "audio";
  readonly audio: {
    readonly data: string;
    readonly format: "mp3" | "wav";
  };
}

export interface PiDataMessagePart {
  readonly type: "data";
  readonly name: string;
  readonly data: unknown;
}

export type PiGenerativeUiNode =
  | string
  | {
      readonly component: string;
      readonly props?: Record<string, unknown>;
      readonly children?: readonly PiGenerativeUiNode[];
      readonly key?: string;
    };

export interface PiGenerativeUiMessagePart {
  readonly type: "generative-ui";
  readonly spec: {
    readonly root: PiGenerativeUiNode | readonly PiGenerativeUiNode[];
  };
  readonly id?: string;
  readonly parentId?: string;
}

export interface PiToolCallMessagePart {
  readonly type: "tool-call";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: Readonly<Record<string, PiConversationJsonValue>>;
  readonly result?: unknown;
  readonly isError?: boolean;
  readonly argsText: string;
  readonly artifact?: unknown;
  readonly timing?: PiToolCallTiming;
  readonly mcp?: {
    readonly app?: {
      readonly resourceUri: string;
      readonly mimeType?: string;
      readonly visibility?: readonly ("model" | "app")[];
      readonly serverId?: string;
    };
  };
  readonly providerMetadata?: PiPartProviderMetadata;
  readonly interrupt?: { readonly type: "human"; readonly payload: unknown };
  readonly approval?: {
    readonly id: string;
    readonly approved?: boolean;
    readonly reason?: string;
    readonly isAutomatic?: boolean;
    readonly options?: readonly {
      readonly id: string;
      readonly kind: string;
      readonly label?: string;
      readonly description?: string;
      readonly grants?: readonly string[];
      readonly confirm?: boolean | { readonly title?: string; readonly description?: string };
    }[];
    readonly optionId?: string;
    readonly resolution?: "cancelled" | "expired";
  };
  readonly parentId?: string;
}

export type PiConversationUserMessagePart =
  | PiTextMessagePart
  | PiImageMessagePart
  | PiFileMessagePart
  | PiDataMessagePart
  | PiAudioMessagePart;

export type PiConversationAssistantMessagePart =
  | PiTextMessagePart
  | PiReasoningMessagePart
  | PiToolCallMessagePart
  | PiSourceMessagePart
  | PiFileMessagePart
  | PiImageMessagePart
  | PiDataMessagePart
  | PiGenerativeUiMessagePart;

export interface PiConversationAttachment {
  readonly id: string;
  readonly type: "image" | "document" | "file" | (string & {});
  readonly name: string;
  readonly contentType?: string;
  readonly file?: File;
  readonly content: PiConversationUserMessagePart[];
  readonly status: { readonly type: "complete" };
}

/** Internal Composer dispatch shape used before a prompt becomes a conversation message. */
export interface PiComposerMessage {
  readonly role: "user";
  readonly content: readonly PiConversationUserMessagePart[];
  readonly attachments: readonly PiConversationAttachment[];
  readonly createdAt: Date;
  readonly metadata: { readonly custom: Record<string, unknown> };
  readonly parentId: string | null;
  readonly runConfig?: unknown;
  readonly sourceId: string | null;
}

export interface PiConversationStep {
  readonly messageId?: string;
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
}

interface PiConversationMessageBase {
  readonly id: string;
  readonly createdAt: Date;
  readonly status?: PiMessageStatus;
  readonly attachments?: readonly PiConversationAttachment[];
  readonly metadata: {
    readonly unstable_state?: PiConversationJsonValue;
    readonly unstable_annotations?: readonly PiConversationJsonValue[];
    readonly unstable_data?: readonly PiConversationJsonValue[];
    readonly steps?: readonly PiConversationStep[];
    readonly submittedFeedback?: { readonly type: "positive" | "negative" };
    readonly timing?: PiMessageTiming;
    readonly isOptimistic?: boolean;
    readonly custom: Record<string, unknown>;
  };
}

export interface PiConversationSystemMessage extends PiConversationMessageBase {
  readonly role: "system";
  readonly content: readonly [PiTextMessagePart];
  readonly metadata: {
    readonly timing?: undefined;
    readonly isOptimistic?: boolean;
    readonly custom: Record<string, unknown>;
  };
}

export interface PiConversationUserMessage extends PiConversationMessageBase {
  readonly role: "user";
  readonly content: readonly PiConversationUserMessagePart[];
  readonly attachments: readonly PiConversationAttachment[];
  readonly metadata: {
    readonly timing?: undefined;
    readonly isOptimistic?: boolean;
    readonly custom: Record<string, unknown>;
  };
}

export interface PiConversationAssistantMessage extends PiConversationMessageBase {
  readonly role: "assistant";
  readonly content: readonly PiConversationAssistantMessagePart[];
  readonly status: PiMessageStatus;
  readonly metadata: {
    readonly unstable_state: PiConversationJsonValue;
    readonly unstable_annotations: readonly PiConversationJsonValue[];
    readonly unstable_data: readonly PiConversationJsonValue[];
    readonly steps: readonly PiConversationStep[];
    readonly submittedFeedback?: { readonly type: "positive" | "negative" };
    readonly timing?: PiMessageTiming;
    readonly isOptimistic?: boolean;
    readonly custom: Record<string, unknown>;
  };
}

/** Pi-owned normalized state shared by history, live events, optimistic updates, and Workbench. */
export type PiConversationMessage =
  | PiConversationSystemMessage
  | PiConversationUserMessage
  | PiConversationAssistantMessage;

export interface PiConversationMessageRepository {
  headId: string | null;
  messages: Array<{ message: PiConversationMessage; parentId: string | null }>;
}
