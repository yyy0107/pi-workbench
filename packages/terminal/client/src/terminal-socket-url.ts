import { TERMINAL_WEBSOCKET_PATH } from "@workbench/terminal-contracts";

export interface TerminalPtySocketTarget {
  sessionId: string;
  cwd?: string;
}

export interface ToolTerminalSocketTarget {
  sessionId?: string;
  toolCallId: string;
}

function terminalSocketPath(): URL {
  return new URL(TERMINAL_WEBSOCKET_PATH, "http://workbench.runtime.invalid");
}

function rootRelativePath(url: URL): string {
  return `${url.pathname}${url.search}`;
}

export function ptyTerminalSocketPath(
  target: TerminalPtySocketTarget,
  cols: number,
  rows: number,
): string {
  const url = terminalSocketPath();
  url.searchParams.set("sessionId", target.sessionId);
  if (target.cwd) url.searchParams.set("cwd", target.cwd);
  url.searchParams.set("cols", String(cols));
  url.searchParams.set("rows", String(rows));
  return rootRelativePath(url);
}

export function toolTerminalSocketPath(
  target: ToolTerminalSocketTarget,
  options: { cols?: number; rows?: number; observeInteraction?: boolean } = {},
): string | undefined {
  if (!target.sessionId) return undefined;
  const url = terminalSocketPath();
  url.searchParams.set("sessionId", target.sessionId);
  url.searchParams.set("toolCallId", target.toolCallId);
  if (options.cols !== undefined) url.searchParams.set("cols", String(options.cols));
  if (options.rows !== undefined) url.searchParams.set("rows", String(options.rows));
  if (options.observeInteraction) url.searchParams.set("observe", "interaction");
  return rootRelativePath(url);
}
