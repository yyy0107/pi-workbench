export type MessagePresentationDisclosure =
  | "completed-turn"
  | "steps"
  | "reasoning"
  | "tool"
  | "parallel-tools"
  | "file-changes";

export type MessagePresentationPhase = "streaming" | "steered" | "completed";

const DEFAULT_OPEN: Readonly<
  Record<MessagePresentationPhase, Readonly<Record<MessagePresentationDisclosure, boolean>>>
> = {
  streaming: {
    "completed-turn": false,
    steps: false,
    reasoning: false,
    tool: false,
    "parallel-tools": false,
    "file-changes": false,
  },
  steered: {
    "completed-turn": false,
    steps: true,
    reasoning: false,
    tool: false,
    "parallel-tools": false,
    "file-changes": false,
  },
  completed: {
    "completed-turn": false,
    steps: false,
    reasoning: false,
    tool: false,
    "parallel-tools": false,
    "file-changes": false,
  },
};

export function defaultMessageDisclosureOpen(
  kind: MessagePresentationDisclosure,
  phase: MessagePresentationPhase,
): boolean {
  return DEFAULT_OPEN[phase][kind];
}
