import type { TerminalInteractionState } from "@workbench/terminal-contracts";

export type ToolConnectionStatus =
  | { phase: "connecting" }
  | { phase: "connected" }
  | { phase: "disconnected" }
  | { phase: "stopping" }
  | { phase: "exited"; exitCode: number }
  | { phase: "fallback" }
  | { phase: "error" };

export function terminalToolStatus(
  connection: ToolConnectionStatus,
  running: boolean,
  interaction: TerminalInteractionState,
  userInputRequested: boolean,
) {
  switch (connection.phase) {
    case "exited":
      return running ? "awaitingResult" : "exited";
    case "connecting":
      return "connecting";
    case "disconnected":
      return "reconnecting";
    case "stopping":
      return "stopping";
    case "error":
      return "connectionError";
    case "fallback":
      return undefined;
    case "connected":
      if (interaction === "active") return "interactionActive";
      if (userInputRequested) return "userInputRequested";
      return interaction === "possible" ? "interactionPossible" : "running";
  }
}
