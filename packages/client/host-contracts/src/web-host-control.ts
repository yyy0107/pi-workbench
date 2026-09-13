import {
  CONTROL_NDJSON_MAX_FRAME_BYTES,
  ControlNdjsonDecodeErrorCode,
  ControlNdjsonDecoder,
  encodeControlNdjsonFrame,
  type ControlNdjsonDecodeErrorCode as SharedControlNdjsonDecodeErrorCode,
} from "@workbench/host-contracts/control-ndjson";

export const WEB_HOST_CONTROL_VERSION = 1 as const;
export const WEB_HOST_CONTROL_TRANSPORT = "ndjson-stdio" as const;
export const WEB_HOST_CONTROL_MAX_FRAME_BYTES = CONTROL_NDJSON_MAX_FRAME_BYTES;
export const WEB_HOST_CONTROL_MAX_SHUTDOWN_DEADLINE_MS = 60_000 as const;

export const WEB_HOST_START_FRAME_TYPE = "start" as const;
export const WEB_HOST_SHUTDOWN_FRAME_TYPE = "shutdown" as const;
export const WEB_HOST_READY_FRAME_TYPE = "ready" as const;
export const WEB_HOST_STARTUP_ERROR_FRAME_TYPE = "startup-error" as const;
export const WEB_HOST_SHUTDOWN_ACK_FRAME_TYPE = "shutdown-ack" as const;

export const WebHostShutdownReason = Object.freeze({
  requested: "requested",
  containerExit: "container-exit",
  restart: "restart",
} as const);

export type WebHostShutdownReason =
  (typeof WebHostShutdownReason)[keyof typeof WebHostShutdownReason];

export const WebHostStartupErrorCode = Object.freeze({
  invalidControlFrame: "invalid-control-frame",
  unsupportedControlVersion: "unsupported-control-version",
  startupFailed: "startup-failed",
} as const);

export type WebHostStartupErrorCode =
  (typeof WebHostStartupErrorCode)[keyof typeof WebHostStartupErrorCode];

export interface WebHostStartFrame {
  readonly type: typeof WEB_HOST_START_FRAME_TYPE;
  readonly controlVersion: typeof WEB_HOST_CONTROL_VERSION;
  readonly host: "127.0.0.1";
  /** Zero asks the artifact-local host to allocate an ephemeral loopback port. */
  readonly port: number;
}

export interface WebHostShutdownFrame {
  readonly type: typeof WEB_HOST_SHUTDOWN_FRAME_TYPE;
  readonly controlVersion: typeof WEB_HOST_CONTROL_VERSION;
  readonly reason: WebHostShutdownReason;
  readonly deadlineMs: number;
}

export type WebHostControlInputFrame = WebHostStartFrame | WebHostShutdownFrame;

export interface WebHostReadyFrame {
  readonly type: typeof WEB_HOST_READY_FRAME_TYPE;
  readonly controlVersion: typeof WEB_HOST_CONTROL_VERSION;
  readonly instanceId: string;
  readonly pid: number;
  readonly httpOrigin: string;
}

export interface WebHostStartupErrorFrame {
  readonly type: typeof WEB_HOST_STARTUP_ERROR_FRAME_TYPE;
  readonly controlVersion: typeof WEB_HOST_CONTROL_VERSION;
  readonly code: WebHostStartupErrorCode;
  readonly message: string;
}

export interface WebHostShutdownAckFrame {
  readonly type: typeof WEB_HOST_SHUTDOWN_ACK_FRAME_TYPE;
  readonly controlVersion: typeof WEB_HOST_CONTROL_VERSION;
}

export type WebHostControlOutputFrame =
  | WebHostReadyFrame
  | WebHostStartupErrorFrame
  | WebHostShutdownAckFrame;

export const WebHostControlDecodeErrorCode = ControlNdjsonDecodeErrorCode;
export type WebHostControlDecodeErrorCode = SharedControlNdjsonDecodeErrorCode;

export class WebHostControlDecodeError extends Error {
  readonly code: WebHostControlDecodeErrorCode;

  constructor(code: WebHostControlDecodeErrorCode) {
    super("Invalid Web Host control input.");
    this.name = "WebHostControlDecodeError";
    this.code = code;
  }
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: JsonRecord, expectedKeys: readonly string[]): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.length && expectedKeys.every((key) => Object.hasOwn(value, key))
  );
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 32 || codePoint === 127);
    })
  );
}

function isRequestedPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 65_535;
}

function isBoundPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65_535;
}

function isProcessId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isShutdownDeadline(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= WEB_HOST_CONTROL_MAX_SHUTDOWN_DEADLINE_MS
  );
}

function isShutdownReason(value: unknown): value is WebHostShutdownReason {
  return Object.values(WebHostShutdownReason).includes(value as WebHostShutdownReason);
}

function isLoopbackHttpOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    const port = Number(parsed.port);
    return (
      parsed.protocol === "http:" &&
      parsed.hostname === "127.0.0.1" &&
      isBoundPort(port) &&
      !parsed.username &&
      !parsed.password &&
      parsed.pathname === "/" &&
      !parsed.search &&
      !parsed.hash &&
      parsed.origin === value
    );
  } catch {
    return false;
  }
}

function startupErrorMessage(code: WebHostStartupErrorCode): string {
  switch (code) {
    case WebHostStartupErrorCode.invalidControlFrame:
      return "Web Host control input is invalid.";
    case WebHostStartupErrorCode.unsupportedControlVersion:
      return "Web Host control protocol version is unsupported.";
    case WebHostStartupErrorCode.startupFailed:
      return "Web Host startup failed.";
  }
}

export function parseWebHostStartFrame(value: unknown): WebHostStartFrame | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["type", "controlVersion", "host", "port"]) ||
    value.type !== WEB_HOST_START_FRAME_TYPE ||
    value.controlVersion !== WEB_HOST_CONTROL_VERSION ||
    value.host !== "127.0.0.1" ||
    !isRequestedPort(value.port)
  ) {
    return undefined;
  }
  return Object.freeze({
    type: WEB_HOST_START_FRAME_TYPE,
    controlVersion: WEB_HOST_CONTROL_VERSION,
    host: "127.0.0.1" as const,
    port: value.port,
  });
}

export function parseWebHostShutdownFrame(value: unknown): WebHostShutdownFrame | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["type", "controlVersion", "reason", "deadlineMs"]) ||
    value.type !== WEB_HOST_SHUTDOWN_FRAME_TYPE ||
    value.controlVersion !== WEB_HOST_CONTROL_VERSION ||
    !isShutdownReason(value.reason) ||
    !isShutdownDeadline(value.deadlineMs)
  ) {
    return undefined;
  }
  return Object.freeze({
    type: WEB_HOST_SHUTDOWN_FRAME_TYPE,
    controlVersion: WEB_HOST_CONTROL_VERSION,
    reason: value.reason,
    deadlineMs: value.deadlineMs,
  });
}

export function parseWebHostControlInputFrame(
  value: unknown,
): WebHostControlInputFrame | undefined {
  return parseWebHostStartFrame(value) ?? parseWebHostShutdownFrame(value);
}

export function webHostControlInputErrorCode(
  value: unknown,
):
  | typeof WebHostStartupErrorCode.invalidControlFrame
  | typeof WebHostStartupErrorCode.unsupportedControlVersion {
  return isRecord(value) &&
    Number.isSafeInteger(value.controlVersion) &&
    value.controlVersion !== WEB_HOST_CONTROL_VERSION
    ? WebHostStartupErrorCode.unsupportedControlVersion
    : WebHostStartupErrorCode.invalidControlFrame;
}

export function parseWebHostReadyFrame(value: unknown): WebHostReadyFrame | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["type", "controlVersion", "instanceId", "pid", "httpOrigin"]) ||
    value.type !== WEB_HOST_READY_FRAME_TYPE ||
    value.controlVersion !== WEB_HOST_CONTROL_VERSION ||
    !isIdentifier(value.instanceId) ||
    !isProcessId(value.pid) ||
    !isLoopbackHttpOrigin(value.httpOrigin)
  ) {
    return undefined;
  }
  return Object.freeze({
    type: WEB_HOST_READY_FRAME_TYPE,
    controlVersion: WEB_HOST_CONTROL_VERSION,
    instanceId: value.instanceId,
    pid: value.pid,
    httpOrigin: value.httpOrigin,
  });
}

export function parseWebHostStartupErrorFrame(
  value: unknown,
): WebHostStartupErrorFrame | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["type", "controlVersion", "code", "message"]) ||
    value.type !== WEB_HOST_STARTUP_ERROR_FRAME_TYPE ||
    value.controlVersion !== WEB_HOST_CONTROL_VERSION ||
    !Object.values(WebHostStartupErrorCode).includes(value.code as WebHostStartupErrorCode)
  ) {
    return undefined;
  }
  const code = value.code as WebHostStartupErrorCode;
  if (value.message !== startupErrorMessage(code)) return undefined;
  return Object.freeze({
    type: WEB_HOST_STARTUP_ERROR_FRAME_TYPE,
    controlVersion: WEB_HOST_CONTROL_VERSION,
    code,
    message: startupErrorMessage(code),
  });
}

export function parseWebHostShutdownAckFrame(value: unknown): WebHostShutdownAckFrame | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["type", "controlVersion"]) ||
    value.type !== WEB_HOST_SHUTDOWN_ACK_FRAME_TYPE ||
    value.controlVersion !== WEB_HOST_CONTROL_VERSION
  ) {
    return undefined;
  }
  return Object.freeze({
    type: WEB_HOST_SHUTDOWN_ACK_FRAME_TYPE,
    controlVersion: WEB_HOST_CONTROL_VERSION,
  });
}

export function parseWebHostControlOutputFrame(
  value: unknown,
): WebHostControlOutputFrame | undefined {
  return (
    parseWebHostReadyFrame(value) ??
    parseWebHostStartupErrorFrame(value) ??
    parseWebHostShutdownAckFrame(value)
  );
}

export function createWebHostStartFrame(
  value: Omit<WebHostStartFrame, "type" | "controlVersion">,
): WebHostStartFrame {
  const frame = parseWebHostStartFrame({
    type: WEB_HOST_START_FRAME_TYPE,
    controlVersion: WEB_HOST_CONTROL_VERSION,
    ...value,
  });
  if (!frame) throw new Error("Invalid Web Host start frame.");
  return frame;
}

export function createWebHostShutdownFrame(
  value: Omit<WebHostShutdownFrame, "type" | "controlVersion">,
): WebHostShutdownFrame {
  const frame = parseWebHostShutdownFrame({
    type: WEB_HOST_SHUTDOWN_FRAME_TYPE,
    controlVersion: WEB_HOST_CONTROL_VERSION,
    ...value,
  });
  if (!frame) throw new Error("Invalid Web Host shutdown frame.");
  return frame;
}

export function createWebHostReadyFrame(
  value: Omit<WebHostReadyFrame, "type" | "controlVersion">,
): WebHostReadyFrame {
  const frame = parseWebHostReadyFrame({
    type: WEB_HOST_READY_FRAME_TYPE,
    controlVersion: WEB_HOST_CONTROL_VERSION,
    ...value,
  });
  if (!frame) throw new Error("Invalid Web Host ready frame.");
  return frame;
}

export function createWebHostStartupErrorFrame(
  code: WebHostStartupErrorCode,
): WebHostStartupErrorFrame {
  const frame = parseWebHostStartupErrorFrame({
    type: WEB_HOST_STARTUP_ERROR_FRAME_TYPE,
    controlVersion: WEB_HOST_CONTROL_VERSION,
    code,
    message: startupErrorMessage(code),
  });
  if (!frame) throw new Error("Invalid Web Host startup error code.");
  return frame;
}

export function createWebHostShutdownAckFrame(): WebHostShutdownAckFrame {
  return Object.freeze({
    type: WEB_HOST_SHUTDOWN_ACK_FRAME_TYPE,
    controlVersion: WEB_HOST_CONTROL_VERSION,
  });
}

export function encodeWebHostControlInputFrame(frame: unknown): string {
  const parsed = parseWebHostControlInputFrame(frame);
  if (!parsed) throw new Error("Invalid Web Host control input frame.");
  return encodeControlNdjsonFrame(parsed, WEB_HOST_CONTROL_MAX_FRAME_BYTES);
}

export function encodeWebHostControlOutputFrame(frame: unknown): string {
  const parsed = parseWebHostControlOutputFrame(frame);
  if (!parsed) throw new Error("Invalid Web Host control output frame.");
  return encodeControlNdjsonFrame(parsed, WEB_HOST_CONTROL_MAX_FRAME_BYTES);
}

export class WebHostControlNdjsonDecoder {
  readonly #decoder = new ControlNdjsonDecoder({
    maximumFrameBytes: WEB_HOST_CONTROL_MAX_FRAME_BYTES,
    createError: (code) => new WebHostControlDecodeError(code),
  });

  push(chunk: Uint8Array): readonly unknown[] {
    return this.#decoder.push(chunk);
  }

  finish(): void {
    this.#decoder.finish();
  }
}
