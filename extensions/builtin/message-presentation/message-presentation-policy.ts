export type MessagePresentationDisclosure =
  | "completed-turn"
  | "steps"
  | "reasoning"
  | "tool"
  | "parallel-tools";

export type MessagePresentationPhase = "streaming" | "completed";

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
