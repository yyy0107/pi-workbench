/** The IPC control version used by the current combined Workbench launcher. */
export const WORKBENCH_HOST_CONTROL_VERSION = 1 as const;

export const WORKBENCH_HOST_READY_MESSAGE_TYPE = "workbench:ready" as const;
export const WORKBENCH_HOST_SHUTDOWN_MESSAGE_TYPE = "workbench:shutdown" as const;

/** Credential-free ready payload sent from the current Runtime Host process to its parent. */
export interface WorkbenchHostReadyMessage {
  readonly type: typeof WORKBENCH_HOST_READY_MESSAGE_TYPE;
  readonly version: typeof WORKBENCH_HOST_CONTROL_VERSION;
  readonly host: string;
  readonly port: number;
  readonly pid: number;
}

/** Current shutdown IPC is intentionally minimal for compatibility with the existing supervisor. */
export interface WorkbenchHostShutdownMessage {
  readonly type: typeof WORKBENCH_HOST_SHUTDOWN_MESSAGE_TYPE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function isControlString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    })
  );
}

function isPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65_535;
}

function isProcessId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Parses the legacy process IPC ready message as an exact, credential-free DTO.
 * Extra fields are rejected so an access token can never become part of a ready
 * payload by accident.
 */
export function parseWorkbenchHostReadyMessage(
  value: unknown,
): WorkbenchHostReadyMessage | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["type", "version", "host", "port", "pid"]) ||
    value.type !== WORKBENCH_HOST_READY_MESSAGE_TYPE ||
    value.version !== WORKBENCH_HOST_CONTROL_VERSION ||
    !isControlString(value.host) ||
    !isPort(value.port) ||
    !isProcessId(value.pid)
  ) {
    return undefined;
  }
  return Object.freeze({
    type: WORKBENCH_HOST_READY_MESSAGE_TYPE,
    version: WORKBENCH_HOST_CONTROL_VERSION,
    host: value.host,
    port: value.port,
    pid: value.pid,
  });
}

/** Creates the exact ready payload sent by production Runtime Host composition. */
export function createWorkbenchHostReadyMessage(
  value: Omit<WorkbenchHostReadyMessage, "type" | "version">,
): WorkbenchHostReadyMessage {
  const message = parseWorkbenchHostReadyMessage({
    type: WORKBENCH_HOST_READY_MESSAGE_TYPE,
    version: WORKBENCH_HOST_CONTROL_VERSION,
    ...value,
  });
  if (!message) throw new Error("Invalid Workbench Host ready message.");
  return message;
}

/** Parses the current compatible shutdown IPC message without accepting arbitrary fields. */
export function parseWorkbenchHostShutdownMessage(
  value: unknown,
): WorkbenchHostShutdownMessage | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["type"]) ||
    value.type !== WORKBENCH_HOST_SHUTDOWN_MESSAGE_TYPE
  ) {
    return undefined;
  }
  return Object.freeze({ type: WORKBENCH_HOST_SHUTDOWN_MESSAGE_TYPE });
}

/** Creates the exact credential-free shutdown request used by managed process IPC. */
export function createWorkbenchHostShutdownMessage(): WorkbenchHostShutdownMessage {
  return Object.freeze({ type: WORKBENCH_HOST_SHUTDOWN_MESSAGE_TYPE });
}

export function isWorkbenchHostShutdownMessage(
  value: unknown,
): value is WorkbenchHostShutdownMessage {
  return parseWorkbenchHostShutdownMessage(value) !== undefined;
}
