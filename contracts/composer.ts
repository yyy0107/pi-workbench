/**
 * Canonical, serializable Composer contract shared by the extension compiler and runtime parser.
 *
 * Keep this module free of React, extension registries, runtime implementations, and legacy
 * compatibility parsing so both sides of the boundary can depend on the same data model.
 */

export type ComposerJsonPrimitive = string | number | boolean | null;
export type ComposerJsonValue =
  | ComposerJsonPrimitive
  | readonly ComposerJsonValue[]
  | { readonly [key: string]: ComposerJsonValue };

/** JSON-Schema-compatible command argument description. */
export type ComposerCommandArgsSchema = Readonly<Record<string, ComposerJsonValue>>;

/**
 * Identifies the primary free-text field rendered by the structured command parameter panel.
 * `consumeText` remains part of the wire contract for legacy clients that sent inline arguments.
 */
export interface ComposerCommandArgsBinding {
  readonly kind: "message-text";
  readonly field: string;
  readonly consumeText: boolean;
}

export const COMPOSER_COMMAND_EFFECTS = [
  "session-action",
  "request-config",
  "instruction",
  "context-provider",
  "prompt-transform",
  "agent-turn",
] as const;

export type ComposerCommandEffect = (typeof COMPOSER_COMMAND_EFFECTS)[number];
export type ComposerCommandScope = "message" | "segment";
export type ComposerCommandSource = "workbench" | "pi";

export interface ComposerCommandSubmission {
  readonly id: string;
  readonly commandId: string;
  readonly label: string;
  readonly scope: ComposerCommandScope;
  readonly source: ComposerCommandSource;
  readonly args?: ComposerJsonValue;
}

export interface ComposerTextNode {
  readonly type: "text";
  readonly text: string;
}

export interface ComposerCommandNode extends ComposerCommandSubmission {
  readonly type: "command";
  /** Present only when a later modifier/group member superseded this display token. */
  readonly inactive?: true;
}

export interface ComposerCommandArgumentNode {
  readonly type: "command-argument";
  readonly id: string;
  readonly commandNodeId: string;
  readonly field: string;
  readonly text: string;
}

export interface ComposerMentionNode {
  readonly type: "mention";
  readonly id: string;
  readonly mentionType: string;
  readonly value: string;
  readonly label: string;
}

export interface ComposerAttachmentNode {
  readonly type: "attachment";
  readonly id: string;
  readonly attachmentType: string;
  readonly value: string;
  readonly label: string;
}

export type ComposerDocumentNode =
  | ComposerTextNode
  | ComposerCommandNode
  | ComposerCommandArgumentNode
  | ComposerMentionNode
  | ComposerAttachmentNode;

export type ComposerDocument = readonly ComposerDocumentNode[];

export interface ComposerContextSubmission {
  readonly type: string;
  readonly value: ComposerJsonValue;
}

/** Current canonical request emitted by the Composer compiler. */
export interface CanonicalComposerRequest {
  readonly version: 1;
  readonly document: ComposerDocument;
  readonly sourceText: string;
  readonly text: string;
  readonly mode?: string;
  readonly model?: string;
  readonly context: readonly ComposerContextSubmission[];
  readonly metadata: Readonly<Record<string, ComposerJsonValue>>;
  readonly commands: readonly ComposerCommandSubmission[];
}

/** Wire-compatible request. `document` is optional only for pre-document v1 clients. */
export type ComposerSubmission = Omit<CanonicalComposerRequest, "document"> & {
  readonly document?: ComposerDocument;
};

/** Hidden structural marker persisted alongside the visible user message. */
export interface ComposerUserProjection {
  readonly version: 1;
  readonly submissionId: string;
  readonly sourceText: string;
  readonly document?: ComposerDocument;
  readonly hidden: true;
}
