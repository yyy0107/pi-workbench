import type { TerminalInteractionState } from "@/runtime/terminal/contracts";

export function shouldExpandInteractiveTerminal(
  interactionState: TerminalInteractionState,
  running: boolean,
  open: boolean,
): boolean {
  return running && !open && interactionState !== "none";
}

export function shouldRevealInteractiveTerminal(
  interactionState: TerminalInteractionState,
  running: boolean,
  alreadyRevealed: boolean,
): boolean {
  return running && !alreadyRevealed && interactionState !== "none";
}
