import type { MessageBlock } from "@workbench/agent-runtime-contracts/conversation";
import { isTodoTool } from "@workbench/ui-todo/model";

export function visibleMessageBlocks(
  blocks: readonly MessageBlock[],
  showReasoning: boolean,
  showTodos = true,
) {
  return showReasoning && showTodos
    ? blocks
    : blocks.filter(
        (block) =>
          (showReasoning || block.kind !== "reasoning") &&
          (showTodos || block.kind !== "tool-call" || !isTodoTool(block.toolName)),
      );
}

export {
  defaultMessageDisclosureOpen,
  type MessagePresentationDisclosure,
  type MessagePresentationPhase,
} from "@workbench/ui-tool/message-disclosure-policy";

export function messageTextPresentation(
  role: "user" | "assistant" | "system",
): "composer" | "markdown" {
  return role === "user" ? "composer" : "markdown";
}

interface ReferenceableMessagePart {
  readonly kind: string;
  readonly mediaType?: string;
  readonly source?: string;
  readonly fileAttachment?: { readonly mediaType: string };
  readonly imageAttachment?: { readonly mediaType: string };
}

function messagePartMediaType(part: ReferenceableMessagePart | undefined): string | undefined {
  return (
    part?.mediaType ??
    part?.fileAttachment?.mediaType ??
    part?.imageAttachment?.mediaType ??
    (typeof part?.source === "string" ? /^data:([^;,]+)/iu.exec(part.source)?.[1] : undefined)
  );
}

export function messageAttachmentVisualKind(
  part: ReferenceableMessagePart | undefined,
): "image" | "file" | undefined {
  if (part?.kind !== "file") return undefined;
  return messagePartMediaType(part)?.startsWith("image/") === true ? "image" : "file";
}

/** Returns the consecutive attachment indices beginning at `start`. */
export function consecutiveAttachmentIndices(
  parts: readonly ReferenceableMessagePart[],
  start: number,
  end = parts.length,
): readonly number[] {
  if (start < 0 || start >= end || !messageAttachmentVisualKind(parts[start])) return [];

  const indices: number[] = [];
  const limit = Math.min(end, parts.length);
  for (let index = start; index < limit && messageAttachmentVisualKind(parts[index]); index += 1) {
    indices.push(index);
  }
  return indices;
}

/** Returns the one-based, per-kind reference shown on user attachment parts. */
export function messageAttachmentReference(
  parts: readonly ReferenceableMessagePart[],
  index: number,
): { kind: "image" | "pdf"; sequence: number } | undefined {
  const target = parts[index];
  const targetMediaType = messagePartMediaType(target);
  const kind =
    target?.kind === "file" && targetMediaType?.startsWith("image/")
      ? "image"
      : target?.kind === "file" && targetMediaType === "application/pdf"
        ? "pdf"
        : undefined;
  if (!kind) return undefined;

  let sequence = 0;
  for (let partIndex = 0; partIndex <= index; partIndex += 1) {
    const part = parts[partIndex];
    const mediaType = messagePartMediaType(part);
    if (
      (kind === "image" && part?.kind === "file" && mediaType?.startsWith("image/")) ||
      (kind === "pdf" && part?.kind === "file" && mediaType === "application/pdf")
    ) {
      sequence += 1;
    }
  }
  return { kind, sequence };
}
