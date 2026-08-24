import { TERMINAL_WEBSOCKET_PATH } from "@/runtime/terminal/contracts";

import type { TerminalPtyTarget, TerminalTranscriptTarget } from "./terminal-target";

function terminalSocketUrl(): URL {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return new URL(TERMINAL_WEBSOCKET_PATH, `${protocol}//${window.location.host}`);
}

export function ptyTerminalSocketUrl(
  target: Pick<TerminalPtyTarget, "sessionId" | "cwd">,
  cols: number,
  rows: number,
): string {
  const url = terminalSocketUrl();
  url.searchParams.set("sessionId", target.sessionId);
  if (target.cwd) url.searchParams.set("cwd", target.cwd);
  url.searchParams.set("cols", String(cols));
  url.searchParams.set("rows", String(rows));
  return url.toString();
}

export function toolTerminalSocketUrl(
  target: Pick<TerminalTranscriptTarget, "piSessionId" | "toolCallId">,
  options: { cols?: number; rows?: number; observeInteraction?: boolean } = {},
): string | undefined {
  if (!target.piSessionId) return undefined;
  const url = terminalSocketUrl();
  url.searchParams.set("sessionId", target.piSessionId);
  url.searchParams.set("toolCallId", target.toolCallId);
  if (options.cols !== undefined) url.searchParams.set("cols", String(options.cols));
  if (options.rows !== undefined) url.searchParams.set("rows", String(options.rows));
  if (options.observeInteraction) url.searchParams.set("observe", "interaction");
  return url.toString();
}
