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

/** A Runtime-owned text file. The model receives its path, never an inline copy. */
export interface PastedTextAttachment {
  readonly id: string;
  readonly name: string;
  readonly mediaType: "text/plain";
  readonly path: string;
  readonly bytes: number;
  readonly characterCount: number;
  readonly preview: string;
}

export const MANAGED_IMAGE_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type ManagedImageMediaType = (typeof MANAGED_IMAGE_MEDIA_TYPES)[number];

/** Detects the supported raster image type from its binary signature. */
export function detectManagedImageMediaType(
  bytes: ArrayLike<number>,
): ManagedImageMediaType | undefined {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return undefined;
}

/** A Runtime-owned file. The persisted descriptor and path are the source of truth. */
export interface ManagedFileAttachment {
  readonly id: string;
  readonly name: string;
  readonly mediaType: string;
  readonly path: string;
  readonly bytes: number;
}

export type ManagedImageAttachment = ManagedFileAttachment & {
  readonly mediaType: ManagedImageMediaType;
};

export function parseManagedFileAttachment(value: unknown): ManagedFileAttachment | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Partial<ManagedFileAttachment>;
  if (
    typeof item.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(item.id) ||
    typeof item.name !== "string" ||
    !item.name ||
    typeof item.mediaType !== "string" ||
    !item.mediaType ||
    typeof item.path !== "string" ||
    !item.path ||
    typeof item.bytes !== "number" ||
    !Number.isSafeInteger(item.bytes) ||
    item.bytes < 0
  ) {
    return undefined;
  }
  return {
    id: item.id,
    name: item.name,
    mediaType: item.mediaType,
    path: item.path,
    bytes: item.bytes,
  };
}

export function parseManagedImageAttachment(value: unknown): ManagedImageAttachment | undefined {
  const attachment = parseManagedFileAttachment(value);
  const mediaType = MANAGED_IMAGE_MEDIA_TYPES.find(
    (candidate) => candidate === attachment?.mediaType,
  );
  return attachment && mediaType ? { ...attachment, mediaType } : undefined;
}

export function parsePastedTextAttachment(value: unknown): PastedTextAttachment | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Partial<PastedTextAttachment>;
  if (
    typeof item.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(item.id) ||
    item.mediaType !== "text/plain" ||
    typeof item.name !== "string" ||
    typeof item.path !== "string" ||
    typeof item.preview !== "string" ||
    typeof item.bytes !== "number" ||
    !Number.isSafeInteger(item.bytes) ||
    item.bytes < 0 ||
    typeof item.characterCount !== "number" ||
    !Number.isSafeInteger(item.characterCount) ||
    item.characterCount < 0
  )
    return undefined;
  return {
    id: item.id,
    name: item.name,
    mediaType: item.mediaType,
    path: item.path,
    bytes: item.bytes,
    characterCount: item.characterCount,
    preview: item.preview,
  };
}

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

/** Stable directive and context identifiers for referencing another conversation. */
export const COMPOSER_CONVERSATION_MENTION_TYPE = "conversation";
export const COMPOSER_CONVERSATION_CONTEXT_TYPE = "workbench.conversation";

/** Stable directive and context identifiers for referencing a file in a workspace. */
export const COMPOSER_WORKSPACE_FILE_MENTION_TYPE = "workspace-file";
export const COMPOSER_WORKSPACE_FILE_CONTEXT_TYPE = "workbench.workspace-file";

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
