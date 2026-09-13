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
}

/** Returns the one-based, per-kind reference shown on user attachment parts. */
export function messageAttachmentReference(
  parts: readonly ReferenceableMessagePart[],
  index: number,
): { kind: "image" | "pdf"; sequence: number } | undefined {
  const target = parts[index];
  const kind =
    target?.kind === "file" && target.mediaType?.startsWith("image/")
      ? "image"
      : target?.kind === "file" && target.mediaType === "application/pdf"
        ? "pdf"
        : undefined;
  if (!kind) return undefined;

  let sequence = 0;
  for (let partIndex = 0; partIndex <= index; partIndex += 1) {
    const part = parts[partIndex];
    if (
      (kind === "image" && part?.kind === "file" && part.mediaType?.startsWith("image/")) ||
      (kind === "pdf" && part?.kind === "file" && part.mediaType === "application/pdf")
    ) {
      sequence += 1;
    }
  }
  return { kind, sequence };
}
