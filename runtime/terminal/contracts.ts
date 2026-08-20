export const TERMINAL_WEBSOCKET_PATH = "/api/terminal";

export const TERMINAL_ERROR_CODES = [
  "invalid-message",
  "invalid-session",
  "cwd-unavailable",
  "session-conflict",
  "session-limit",
  "internal-error",
] as const;

export type TerminalErrorCode = (typeof TERMINAL_ERROR_CODES)[number];

export type TerminalClientFrame =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "interrupt" }
  | { type: "run"; command: string };

export type TerminalServerFrame =
  | {
      type: "ready";
      sessionId: string;
      cwd: string;
      process: string;
      pid: number;
    }
  | { type: "data"; data: string }
  | { type: "exit"; exitCode: number; signal?: number }
  | { type: "error"; code: TerminalErrorCode };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedInteger(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
}

export function parseTerminalClientFrame(value: unknown): TerminalClientFrame | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;

  if (value.type === "input") {
    return typeof value.data === "string" && value.data.length <= 65_536
      ? { type: "input", data: value.data }
      : undefined;
  }

  if (value.type === "resize") {
    return isBoundedInteger(value.cols, 2, 500) && isBoundedInteger(value.rows, 1, 300)
      ? { type: "resize", cols: value.cols, rows: value.rows }
      : undefined;
  }

  if (value.type === "interrupt") return { type: "interrupt" };

  if (value.type === "run") {
    return typeof value.command === "string" &&
      value.command.trim().length > 0 &&
      value.command.length <= 32_768
      ? { type: "run", command: value.command }
      : undefined;
  }

  return undefined;
}

export function parseTerminalServerFrame(value: unknown): TerminalServerFrame | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;

  if (value.type === "ready") {
    return typeof value.sessionId === "string" &&
      typeof value.cwd === "string" &&
      typeof value.process === "string" &&
      isBoundedInteger(value.pid, 1, Number.MAX_SAFE_INTEGER)
      ? {
          type: "ready",
          sessionId: value.sessionId,
          cwd: value.cwd,
          process: value.process,
          pid: value.pid,
        }
      : undefined;
  }

  if (value.type === "data") {
    return typeof value.data === "string" ? { type: "data", data: value.data } : undefined;
  }

  if (value.type === "exit") {
    return Number.isInteger(value.exitCode) &&
      (value.signal === undefined || Number.isInteger(value.signal))
      ? {
          type: "exit",
          exitCode: Number(value.exitCode),
          ...(value.signal === undefined ? {} : { signal: Number(value.signal) }),
        }
      : undefined;
  }

  if (value.type === "error") {
    return typeof value.code === "string" &&
      TERMINAL_ERROR_CODES.includes(value.code as TerminalErrorCode)
      ? { type: "error", code: value.code as TerminalErrorCode }
      : undefined;
  }

  return undefined;
}
