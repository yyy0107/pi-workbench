import { RuntimeWebSocketReadyState, type RuntimeWebSocket } from "@workbench/host-client";

/** Terminal frames are writable only after both Runtime auth and process bootstrap complete. */
export function isTerminalSocketWritable(
  socket: RuntimeWebSocket | undefined,
  processReady: boolean,
): socket is RuntimeWebSocket {
  return processReady && socket?.readyState === RuntimeWebSocketReadyState.open;
}

export function terminalReconnectDelay(
  attempt: number,
  options: Readonly<{ baseMs: number; maxMs: number; exponentCap: number }>,
): number {
  return Math.min(options.maxMs, options.baseMs * 2 ** Math.min(attempt, options.exponentCap));
}

export function isInvalidTerminalSessionClose(event: unknown): boolean {
  return typeof event === "object" && event !== null && "code" in event && event.code === 1008;
}
