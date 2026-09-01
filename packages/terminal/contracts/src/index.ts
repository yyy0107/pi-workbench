export const TERMINAL_WEBSOCKET_PATH = "/api/terminal";

export * from "./bash-tool-input";

export const TERMINAL_ERROR_CODES = [
  "invalid-message",
  "invalid-session",
  "cwd-unavailable",
  "session-conflict",
  "session-limit",
  "internal-error",
] as const;

export type TerminalErrorCode = (typeof TERMINAL_ERROR_CODES)[number];

export const TERMINAL_INTERACTION_STATES = ["none", "possible", "active"] as const;
export type TerminalInteractionState = (typeof TERMINAL_INTERACTION_STATES)[number];

export const TERMINAL_PROCESS_KINDS = ["shell", "tool"] as const;
export type TerminalProcessKind = (typeof TERMINAL_PROCESS_KINDS)[number];

export const TERMINAL_PROCESS_STATES = ["running", "exited", "killed"] as const;
export type TerminalProcessState = (typeof TERMINAL_PROCESS_STATES)[number];

export const TERMINAL_ATTACHMENT_STATES = ["detached", "attached"] as const;
export type TerminalAttachmentState = (typeof TERMINAL_ATTACHMENT_STATES)[number];

export const TERMINAL_EXIT_REASONS = ["exited", "aborted", "timeout", "terminated"] as const;
export type TerminalExitReason = (typeof TERMINAL_EXIT_REASONS)[number];

export interface TerminalProcessSnapshot {
  processHandle: string;
  sessionId: string;
  kind: TerminalProcessKind;
  cwd: string;
  process: string;
  pid: number;
  tty: true;
  processState: TerminalProcessState;
  interactionState: TerminalInteractionState;
  attachmentState: TerminalAttachmentState;
  startedAt: number;
  outputBytes: number;
  outputBytesCap: number;
  outputCapReached: boolean;
}

export interface TerminalOutputDelta {
  processHandle: string;
  sequence: number;
  stream: "terminal";
  data: string;
  outputBytes: number;
  outputCapReached: boolean;
}

export interface TerminalProcessExit {
  processHandle: string;
  processState: "exited" | "killed";
  reason: TerminalExitReason;
  exitCode: number;
  signal?: number;
  outputBytes: number;
  outputCapReached: boolean;
}

export type TerminalClientFrame =
  | { type: "process/write-stdin"; processHandle: string; data: string }
  | { type: "process/resize"; processHandle: string; cols: number; rows: number }
  | { type: "process/interrupt"; processHandle: string }
  | { type: "process/terminate"; processHandle: string }
  | { type: "process/run"; processHandle: string; command: string };

export type TerminalServerFrame =
  | { type: "process/ready"; process: TerminalProcessSnapshot }
  | { type: "process/output-delta"; delta: TerminalOutputDelta }
  | {
      type: "process/state";
      processHandle: string;
      processState: TerminalProcessState;
      interactionState: TerminalInteractionState;
      attachmentState: TerminalAttachmentState;
    }
  | { type: "process/exited"; exit: TerminalProcessExit }
  | { type: "process/error"; processHandle?: string; code: TerminalErrorCode };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedInteger(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
}

function isProcessHandle(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1024;
}

function parseProcessSnapshot(value: unknown): TerminalProcessSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isProcessHandle(value.processHandle) ||
    typeof value.sessionId !== "string" ||
    typeof value.kind !== "string" ||
    !TERMINAL_PROCESS_KINDS.includes(value.kind as TerminalProcessKind) ||
    typeof value.cwd !== "string" ||
    typeof value.process !== "string" ||
    !isBoundedInteger(value.pid, 1, Number.MAX_SAFE_INTEGER) ||
    value.tty !== true ||
    typeof value.processState !== "string" ||
    !TERMINAL_PROCESS_STATES.includes(value.processState as TerminalProcessState) ||
    typeof value.interactionState !== "string" ||
    !TERMINAL_INTERACTION_STATES.includes(value.interactionState as TerminalInteractionState) ||
    typeof value.attachmentState !== "string" ||
    !TERMINAL_ATTACHMENT_STATES.includes(value.attachmentState as TerminalAttachmentState) ||
    !isBoundedInteger(value.startedAt, 0, Number.MAX_SAFE_INTEGER) ||
    !isBoundedInteger(value.outputBytes, 0, Number.MAX_SAFE_INTEGER) ||
    !isBoundedInteger(value.outputBytesCap, 1, Number.MAX_SAFE_INTEGER) ||
    typeof value.outputCapReached !== "boolean"
  ) {
    return undefined;
  }
  return {
    processHandle: value.processHandle,
    sessionId: value.sessionId,
    kind: value.kind as TerminalProcessKind,
    cwd: value.cwd,
    process: value.process,
    pid: value.pid,
    tty: true,
    processState: value.processState as TerminalProcessState,
    interactionState: value.interactionState as TerminalInteractionState,
    attachmentState: value.attachmentState as TerminalAttachmentState,
    startedAt: value.startedAt,
    outputBytes: value.outputBytes,
    outputBytesCap: value.outputBytesCap,
    outputCapReached: value.outputCapReached,
  };
}

export function parseTerminalClientFrame(value: unknown): TerminalClientFrame | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;

  if (value.type === "process/write-stdin") {
    return isProcessHandle(value.processHandle) &&
      typeof value.data === "string" &&
      value.data.length <= 65_536
      ? { type: "process/write-stdin", processHandle: value.processHandle, data: value.data }
      : undefined;
  }

  if (value.type === "process/resize") {
    return isProcessHandle(value.processHandle) &&
      isBoundedInteger(value.cols, 2, 500) &&
      isBoundedInteger(value.rows, 1, 300)
      ? {
          type: "process/resize",
          processHandle: value.processHandle,
          cols: value.cols,
          rows: value.rows,
        }
      : undefined;
  }

  if (value.type === "process/interrupt" || value.type === "process/terminate") {
    return isProcessHandle(value.processHandle)
      ? { type: value.type, processHandle: value.processHandle }
      : undefined;
  }

  if (value.type === "process/run") {
    return isProcessHandle(value.processHandle) &&
      typeof value.command === "string" &&
      value.command.trim().length > 0 &&
      value.command.length <= 32_768
      ? { type: "process/run", processHandle: value.processHandle, command: value.command }
      : undefined;
  }

  return undefined;
}

export function parseTerminalServerFrame(value: unknown): TerminalServerFrame | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;

  if (value.type === "process/ready") {
    const process = parseProcessSnapshot(value.process);
    return process ? { type: "process/ready", process } : undefined;
  }

  if (value.type === "process/output-delta") {
    if (!isRecord(value.delta)) return undefined;
    const delta = value.delta;
    return isProcessHandle(delta.processHandle) &&
      isBoundedInteger(delta.sequence, 1, Number.MAX_SAFE_INTEGER) &&
      delta.stream === "terminal" &&
      typeof delta.data === "string" &&
      isBoundedInteger(delta.outputBytes, 0, Number.MAX_SAFE_INTEGER) &&
      typeof delta.outputCapReached === "boolean"
      ? {
          type: "process/output-delta",
          delta: {
            processHandle: delta.processHandle,
            sequence: delta.sequence,
            stream: "terminal",
            data: delta.data,
            outputBytes: delta.outputBytes,
            outputCapReached: delta.outputCapReached,
          },
        }
      : undefined;
  }

  if (value.type === "process/state") {
    return isProcessHandle(value.processHandle) &&
      typeof value.processState === "string" &&
      TERMINAL_PROCESS_STATES.includes(value.processState as TerminalProcessState) &&
      typeof value.interactionState === "string" &&
      TERMINAL_INTERACTION_STATES.includes(value.interactionState as TerminalInteractionState) &&
      typeof value.attachmentState === "string" &&
      TERMINAL_ATTACHMENT_STATES.includes(value.attachmentState as TerminalAttachmentState)
      ? {
          type: "process/state",
          processHandle: value.processHandle,
          processState: value.processState as TerminalProcessState,
          interactionState: value.interactionState as TerminalInteractionState,
          attachmentState: value.attachmentState as TerminalAttachmentState,
        }
      : undefined;
  }

  if (value.type === "process/exited") {
    if (!isRecord(value.exit)) return undefined;
    const exit = value.exit;
    return isProcessHandle(exit.processHandle) &&
      (exit.processState === "exited" || exit.processState === "killed") &&
      typeof exit.reason === "string" &&
      TERMINAL_EXIT_REASONS.includes(exit.reason as TerminalExitReason) &&
      Number.isInteger(exit.exitCode) &&
      (exit.signal === undefined || Number.isInteger(exit.signal)) &&
      isBoundedInteger(exit.outputBytes, 0, Number.MAX_SAFE_INTEGER) &&
      typeof exit.outputCapReached === "boolean"
      ? {
          type: "process/exited",
          exit: {
            processHandle: exit.processHandle,
            processState: exit.processState,
            reason: exit.reason as TerminalExitReason,
            exitCode: Number(exit.exitCode),
            ...(exit.signal === undefined ? {} : { signal: Number(exit.signal) }),
            outputBytes: exit.outputBytes,
            outputCapReached: exit.outputCapReached,
          },
        }
      : undefined;
  }

  if (value.type === "process/error") {
    return typeof value.code === "string" &&
      TERMINAL_ERROR_CODES.includes(value.code as TerminalErrorCode) &&
      (value.processHandle === undefined || isProcessHandle(value.processHandle))
      ? {
          type: "process/error",
          ...(value.processHandle === undefined ? {} : { processHandle: value.processHandle }),
          code: value.code as TerminalErrorCode,
        }
      : undefined;
  }

  return undefined;
}
