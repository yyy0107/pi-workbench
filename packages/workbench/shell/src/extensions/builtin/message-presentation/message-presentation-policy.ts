import type { MessageBlock } from "@workbench/agent-runtime-contracts/conversation";
import { isTodoTool } from "../../../chat/todo-model";

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

export type MessagePresentationDisclosure =
  | "completed-turn"
  | "steps"
  | "reasoning"
  | "tool"
  | "parallel-tools";

export type MessagePresentationPhase = "streaming" | "steered" | "completed";

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

const DEFAULT_OPEN: Readonly<
  Record<MessagePresentationPhase, Readonly<Record<MessagePresentationDisclosure, boolean>>>
> = {
  streaming: {
    "completed-turn": false,
    steps: false,
    reasoning: false,
    tool: false,
    "parallel-tools": false,
  },
  steered: {
    "completed-turn": false,
    steps: true,
    reasoning: false,
    tool: false,
    "parallel-tools": false,
  },
  completed: {
    "completed-turn": false,
    steps: false,
    reasoning: false,
    tool: false,
    "parallel-tools": false,
  },
};

export function defaultMessageDisclosureOpen(
  kind: MessagePresentationDisclosure,
  phase: MessagePresentationPhase,
): boolean {
  return DEFAULT_OPEN[phase][kind];
}
