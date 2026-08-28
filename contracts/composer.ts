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

/** Validates values crossing the serializable Composer boundary. */
export function isComposerJsonValue(value: unknown, depth = 0): value is ComposerJsonValue {
  if (depth > 32) return false;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every((item) => isComposerJsonValue(item, depth + 1));
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((item) => isComposerJsonValue(item, depth + 1))
  );
}

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
/**
 * The owner of a Composer command at the product boundary.
 *
 * Runtime implementations (Pi, Codex, Claude Code, and others) are deliberately represented by
 * `agent`. Their implementation identity must not leak into drafts, RPC requests, or history.
 */
export type ComposerCommandSource = "workbench" | "agent";

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
  readonly version: 2;
  readonly document: ComposerDocument;
  /** Canonical resource-link serialization used for durable logs and cross-runtime recovery. */
  readonly sourceText: string;
  readonly text: string;
  readonly mode?: string;
  readonly model?: string;
  readonly context: readonly ComposerContextSubmission[];
  readonly metadata: Readonly<Record<string, ComposerJsonValue>>;
  readonly commands: readonly ComposerCommandSubmission[];
}

/** Normalized request. `document` remains optional only after reading a pre-document v1 request. */
export type ComposerSubmission = Omit<CanonicalComposerRequest, "document"> & {
  readonly document?: ComposerDocument;
};

/** Hidden structural marker persisted alongside the visible user message. */
export interface ComposerUserProjection {
  readonly version: 2;
  readonly submissionId: string;
  readonly sourceText: string;
  readonly document?: ComposerDocument;
  readonly hidden: true;
}
