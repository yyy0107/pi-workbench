import type { AttachmentReference } from "@/runtime/image-understanding/state-machine";

export type MessagePresentationDisclosure =
  | "completed-turn"
  | "steps"
  | "reasoning"
  | "tool"
  | "parallel-tools";

export type MessagePresentationPhase = "streaming" | "completed";

export function messageTextPresentation(
  role: "user" | "assistant" | "system",
): "composer" | "markdown" {
  return role === "user" ? "composer" : "markdown";
}

interface ReferenceableMessagePart {
  readonly type: string;
  readonly mimeType?: string;
}

/** Returns the one-based, per-kind reference shown on user attachment parts. */
export function messageAttachmentReference(
  parts: readonly ReferenceableMessagePart[],
  index: number,
): AttachmentReference | undefined {
  const target = parts[index];
  const kind =
    target?.type === "image"
      ? "image"
      : target?.type === "file" && target.mimeType === "application/pdf"
        ? "pdf"
        : undefined;
  if (!kind) return undefined;

  let sequence = 0;
  for (let partIndex = 0; partIndex <= index; partIndex += 1) {
    const part = parts[partIndex];
    if (
      (kind === "image" && part?.type === "image") ||
      (kind === "pdf" && part?.type === "file" && part.mimeType === "application/pdf")
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
