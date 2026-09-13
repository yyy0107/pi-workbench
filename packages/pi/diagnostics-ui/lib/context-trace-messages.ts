import type { SessionContextTraceJsonValue } from "@workbench/agent-runtime-pi-protocol/rpc";

export type ContextTraceMessageRole = "system" | "compaction" | "user" | "assistant" | "tool";

export interface ContextTraceMessageEntry {
  id: string;
  role: ContextTraceMessageRole;
  sourceIndex: number;
  value: SessionContextTraceJsonValue;
  text: string;
  preview: string;
  attachments: readonly ContextTraceMessageAttachment[];
  estimatedTokens?: number;
  toolName?: string;
}

export interface ContextTraceMessageAttachment {
  id: string;
  attachmentIndex: number;
  contentIndex: number;
  kind: "image" | "file";
  value: SessionContextTraceJsonValue;
  mediaType?: string;
  name?: string;
  source?: string;
}

export type ContextTraceOutputBlockKind = "text" | "reasoning" | "tool-call";

export interface ContextTraceOutputBlock {
  id: string;
  kind: ContextTraceOutputBlockKind;
  contentIndex: number;
  value: SessionContextTraceJsonValue;
  text: string;
  preview: string;
  toolName?: string;
  toolCallId?: string;
}

export type ContextTraceMessageGroups = Record<
  ContextTraceMessageRole,
  readonly ContextTraceMessageEntry[]
>;

export const CONTEXT_TRACE_MESSAGE_ROLES = [
  "system",
  "compaction",
  "user",
  "assistant",
  "tool",
] as const;

function isJsonObject(value: SessionContextTraceJsonValue): value is {
  [key: string]: SessionContextTraceJsonValue;
} {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function previewText(value: string): string {
  const normalized = normalizedText(value);
  return normalized.length > 180 ? `${normalized.slice(0, 177)}…` : normalized;
}

function jsonText(value: SessionContextTraceJsonValue): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function contentText(value: SessionContextTraceJsonValue): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => contentText(item))
      .filter(Boolean)
      .join("\n\n");
  }
  if (!isJsonObject(value)) return "";
  if (typeof value.text === "string") return value.text;
  if (typeof value.thinking === "string") return value.thinking;
  if (typeof value.summary === "string") return value.summary;
  if (value.content !== undefined) return contentText(value.content);
  return "";
}

const SAFE_INLINE_IMAGE_MEDIA_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

function attachmentMediaType(part: {
  [key: string]: SessionContextTraceJsonValue;
}): string | undefined {
  const value =
    typeof part.mimeType === "string"
      ? part.mimeType
      : typeof part.mediaType === "string"
        ? part.mediaType
        : undefined;
  return value?.toLowerCase();
}

function inlineImageSource(
  value: string | undefined,
  mediaType: string | undefined,
): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("data:")) {
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,[a-z\d+/=\s]+$/iu.exec(value);
    return match && SAFE_INLINE_IMAGE_MEDIA_TYPES.has(match[1]!.toLowerCase()) ? value : undefined;
  }
  if (!mediaType || !SAFE_INLINE_IMAGE_MEDIA_TYPES.has(mediaType)) return undefined;
  return /^[a-z\d+/]*={0,2}$/iu.test(value) ? `data:${mediaType};base64,${value}` : undefined;
}

/** Extracts attachment parts without exposing arbitrary captured values as image URLs. */
export function listContextTraceAttachments(
  value: SessionContextTraceJsonValue,
): readonly ContextTraceMessageAttachment[] {
  const parts = Array.isArray(value)
    ? value
    : isJsonObject(value) && Array.isArray(value.content)
      ? value.content
      : [];

  const attachments = parts.flatMap<Omit<ContextTraceMessageAttachment, "attachmentIndex">>(
    (part, contentIndex) => {
      if (!isJsonObject(part) || typeof part.type !== "string") return [];
      const type = part.type.toLowerCase();
      const mediaType = attachmentMediaType(part);
      const kind =
        type === "image" || mediaType?.startsWith("image/")
          ? ("image" as const)
          : type === "file" || type === "attachment" || type === "document"
            ? ("file" as const)
            : undefined;
      if (!kind) return [];

      const name =
        typeof part.name === "string"
          ? part.name
          : typeof part.filename === "string"
            ? part.filename
            : undefined;
      const data =
        typeof part.data === "string"
          ? part.data
          : typeof part.image === "string"
            ? part.image
            : typeof part.source === "string"
              ? part.source
              : undefined;
      const source = kind === "image" ? inlineImageSource(data, mediaType) : undefined;

      return [
        {
          id: `attachment:${contentIndex}`,
          contentIndex,
          kind,
          value: part,
          ...(mediaType ? { mediaType } : {}),
          ...(name ? { name } : {}),
          ...(source ? { source } : {}),
        },
      ];
    },
  );
  return attachments.map((attachment, attachmentIndex) => ({
    ...attachment,
    attachmentIndex,
  }));
}

function messageEntry(
  role: ContextTraceMessageRole,
  sourceIndex: number,
  value: SessionContextTraceJsonValue,
  estimatedTokens?: number | null,
): ContextTraceMessageEntry {
  const text = contentText(value);
  return {
    id: `${sourceIndex}:message`,
    role,
    sourceIndex,
    value,
    text,
    preview: previewText(text),
    attachments: role === "user" ? listContextTraceAttachments(value) : [],
    ...(estimatedTokens === null || estimatedTokens === undefined ? {} : { estimatedTokens }),
  };
}

function toolCallEntry(
  sourceIndex: number,
  partIndex: number,
  part: { [key: string]: SessionContextTraceJsonValue },
): ContextTraceMessageEntry {
  const toolName = typeof part.name === "string" ? part.name : undefined;
  const argumentsValue = part.arguments ?? part.args ?? null;
  const text = jsonText(argumentsValue);
  return {
    id: `${sourceIndex}:tool-call:${partIndex}`,
    role: "tool",
    sourceIndex,
    value: part,
    text,
    preview: previewText(text),
    attachments: [],
    ...(toolName ? { toolName } : {}),
  };
}

function messageRole(value: string): ContextTraceMessageRole | undefined {
  const role = value.toLowerCase();
  if (role === "system" || role === "developer") return "system";
  if (role === "compactionsummary" || role === "compaction_summary") return "compaction";
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  if (role === "tool" || role === "toolresult" || role === "tool_result") return "tool";
  return undefined;
}

function toolNameFromMessage(message: {
  [key: string]: SessionContextTraceJsonValue;
}): string | undefined {
  return typeof message.toolName === "string"
    ? message.toolName
    : typeof message.name === "string"
      ? message.name
      : undefined;
}

function assistantToolCallNames(message: {
  [key: string]: SessionContextTraceJsonValue;
}): string[] {
  if (!Array.isArray(message.content)) return [];
  return message.content.flatMap((part) =>
    isJsonObject(part) && part.type === "toolCall" && typeof part.name === "string"
      ? [part.name]
      : [],
  );
}

/** Returns captured model-context messages in their exact source order. */
export function listContextTraceMessages(
  value: SessionContextTraceJsonValue,
  tokenEstimates?: readonly (number | null)[],
): readonly ContextTraceMessageEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((message, sourceIndex) => {
    if (!isJsonObject(message) || typeof message.role !== "string") return [];
    const role = messageRole(message.role);
    if (!role) return [];
    const entry = messageEntry(role, sourceIndex, message, tokenEstimates?.[sourceIndex]);
    const toolName = toolNameFromMessage(message);
    const toolCalls = role === "assistant" ? assistantToolCallNames(message) : [];
    const preview =
      entry.preview ||
      (toolCalls.length > 0 ? `tool_call: ${toolCalls.join(", ")}` : entry.preview);
    return [{ ...entry, preview, ...(toolName ? { toolName } : {}) }];
  });
}

/** Preserves the provider-visible block order of a finalized assistant message. */
export function listContextTraceOutputBlocks(
  value: SessionContextTraceJsonValue,
): readonly ContextTraceOutputBlock[] {
  if (!isJsonObject(value) || !Array.isArray(value.content)) return [];
  return value.content.flatMap<ContextTraceOutputBlock>((part, contentIndex) => {
    if (!isJsonObject(part) || typeof part.type !== "string") return [];
    if (part.type === "text" && typeof part.text === "string") {
      return [
        {
          id: `output:${contentIndex}`,
          kind: "text" as const,
          contentIndex,
          value: part,
          text: part.text,
          preview: previewText(part.text),
        },
      ];
    }
    if (part.type === "thinking" && typeof part.thinking === "string") {
      return [
        {
          id: `output:${contentIndex}`,
          kind: "reasoning" as const,
          contentIndex,
          value: part,
          text: part.thinking,
          preview: previewText(part.thinking),
        },
      ];
    }
    if (part.type === "toolCall") {
      const toolName = typeof part.name === "string" ? part.name : undefined;
      const toolCallId = typeof part.id === "string" ? part.id : undefined;
      const text = jsonText(part.arguments ?? null);
      return [
        {
          id: `output:${contentIndex}`,
          kind: "tool-call" as const,
          contentIndex,
          value: part,
          text,
          preview: previewText(text),
          ...(toolName ? { toolName } : {}),
          ...(toolCallId ? { toolCallId } : {}),
        },
      ];
    }
    return [];
  });
}

/**
 * Converts Pi's captured message array into the model-context concepts users reason about. Hidden Workbench
 * bookkeeping messages are deliberately omitted, while assistant tool-call parts become Tool rows.
 */
export function groupContextTraceMessages(
  value: SessionContextTraceJsonValue,
): ContextTraceMessageGroups {
  const groups: Record<ContextTraceMessageRole, ContextTraceMessageEntry[]> = {
    system: [],
    compaction: [],
    user: [],
    assistant: [],
    tool: [],
  };
  if (!Array.isArray(value)) return groups;

  value.forEach((message, sourceIndex) => {
    if (!isJsonObject(message) || typeof message.role !== "string") return;
    const role = message.role.toLowerCase();

    if (role === "system" || role === "developer") {
      groups.system.push(messageEntry("system", sourceIndex, message));
      return;
    }
    if (role === "compactionsummary" || role === "compaction_summary") {
      groups.compaction.push(messageEntry("compaction", sourceIndex, message));
      return;
    }
    if (role === "user") {
      groups.user.push(messageEntry("user", sourceIndex, message));
      return;
    }
    if (role === "tool" || role === "toolresult" || role === "tool_result") {
      const entry = messageEntry("tool", sourceIndex, message);
      const toolName =
        typeof message.toolName === "string"
          ? message.toolName
          : typeof message.name === "string"
            ? message.name
            : undefined;
      groups.tool.push({ ...entry, ...(toolName ? { toolName } : {}) });
      return;
    }
    if (role !== "assistant") return;

    const content = Array.isArray(message.content) ? message.content : undefined;
    if (!content) {
      groups.assistant.push(messageEntry("assistant", sourceIndex, message));
      return;
    }

    const assistantParts: SessionContextTraceJsonValue[] = [];
    content.forEach((part, partIndex) => {
      if (isJsonObject(part) && part.type === "toolCall") {
        groups.tool.push(toolCallEntry(sourceIndex, partIndex, part));
      } else {
        assistantParts.push(part);
      }
    });

    if (assistantParts.length > 0) {
      groups.assistant.push(
        messageEntry("assistant", sourceIndex, { ...message, content: assistantParts }),
      );
    }
  });

  return groups;
}
