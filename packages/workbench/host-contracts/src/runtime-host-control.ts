import {
  CONTROL_NDJSON_MAX_FRAME_BYTES,
  ControlNdjsonDecodeErrorCode,
  ControlNdjsonDecoder,
  encodeControlNdjsonFrame,
  type ControlNdjsonDecodeErrorCode as SharedControlNdjsonDecodeErrorCode,
} from "@workbench/host-contracts/control-ndjson";
import {
  RUNTIME_HOST_PROTOCOL_VERSION,
  isRuntimeHostCredentialSafeString,
  isRuntimeHostProcessId,
} from "@workbench/host-contracts/runtime-host-identity";

export {
  RUNTIME_HOST_HEALTH_PATH,
  RUNTIME_HOST_IDENTITY_PATH,
  RUNTIME_HOST_PRODUCT,
  RUNTIME_HOST_PROTOCOL_VERSION,
  createRuntimeHostHealth,
  createRuntimeHostIdentity,
  parseRuntimeHostHealth,
  parseRuntimeHostIdentity,
  type RuntimeHostHealth,
  type RuntimeHostIdentity,
} from "@workbench/host-contracts/runtime-host-identity";

export const RUNTIME_HOST_CONTROL_VERSION = 1 as const;
export const RUNTIME_HOST_CONTROL_MAX_FRAME_BYTES = CONTROL_NDJSON_MAX_FRAME_BYTES;

export const RuntimeHostShutdownReason = Object.freeze({
  requested: "requested",
  containerExit: "container-exit",
  restart: "restart",
} as const);

export type RuntimeHostShutdownReason =
  (typeof RuntimeHostShutdownReason)[keyof typeof RuntimeHostShutdownReason];

export const RuntimeHostStartupErrorCode = Object.freeze({
  invalidControlFrame: "invalid-control-frame",
  unsupportedControlVersion: "unsupported-control-version",
  startupFailed: "startup-failed",
} as const);

export type RuntimeHostStartupErrorCode =
  (typeof RuntimeHostStartupErrorCode)[keyof typeof RuntimeHostStartupErrorCode];

export interface RuntimeHostStartFrame {
  readonly type: "start";
  readonly controlVersion: typeof RUNTIME_HOST_CONTROL_VERSION;
  readonly authMode: "desktop-sidecar";
  readonly accessToken: string;
  readonly allowedOrigins: readonly string[];
}

export interface RuntimeHostShutdownFrame {
  readonly type: "shutdown";
  readonly controlVersion: typeof RUNTIME_HOST_CONTROL_VERSION;
  readonly reason: RuntimeHostShutdownReason;
  readonly deadlineMs: number;
}

export type RuntimeHostControlInputFrame = RuntimeHostStartFrame | RuntimeHostShutdownFrame;

export interface RuntimeHostReadyFrame {
  readonly type: "ready";
  readonly controlVersion: typeof RUNTIME_HOST_CONTROL_VERSION;
  readonly hostProtocolVersion: typeof RUNTIME_HOST_PROTOCOL_VERSION;
  readonly instanceId: string;
  readonly pid: number;
  readonly httpOrigin: string;
}

export interface RuntimeHostStartupErrorFrame {
  readonly type: "startup-error";
  readonly controlVersion: typeof RUNTIME_HOST_CONTROL_VERSION;
  readonly code: RuntimeHostStartupErrorCode;
  readonly message: string;
}

export interface RuntimeHostShutdownAckFrame {
  readonly type: "shutdown-ack";
  readonly controlVersion: typeof RUNTIME_HOST_CONTROL_VERSION;
}

export type RuntimeHostControlOutputFrame =
  | RuntimeHostReadyFrame
  | RuntimeHostStartupErrorFrame
  | RuntimeHostShutdownAckFrame;

export const RuntimeHostControlDecodeErrorCode = ControlNdjsonDecodeErrorCode;

export type RuntimeHostControlDecodeErrorCode = SharedControlNdjsonDecodeErrorCode;

export class RuntimeHostControlDecodeError extends Error {
  readonly code: RuntimeHostControlDecodeErrorCode;

  constructor(code: RuntimeHostControlDecodeErrorCode) {
    super("Invalid Runtime Host control input.");
    this.name = "RuntimeHostControlDecodeError";
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
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function isCredentialSafeString(value: unknown, maximumLength: number): value is string {
  return isRuntimeHostCredentialSafeString(value, maximumLength);
}

function canonicalRendererOrigin(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) return undefined;
  if (value === "*" || value === "null" || value.length > 2_048 || /[\r\n]/u.test(value)) {
    return undefined;
  }

  try {
    const parsed = new URL(value);
    if (
      !parsed.protocol ||
      !parsed.host ||
      parsed.username ||
      parsed.password ||
      (parsed.pathname !== "" && parsed.pathname !== "/") ||
      parsed.search ||
      parsed.hash
    ) {
      return undefined;
    }
    return parsed.origin === "null" ? `${parsed.protocol}//${parsed.host}` : parsed.origin;
  } catch {
    return undefined;
  }
}

function parseAllowedOrigins(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) return undefined;
  const origins = value.map(canonicalRendererOrigin);
  if (origins.some((origin) => origin === undefined)) return undefined;
  const canonical = origins as string[];
  if (new Set(canonical).size !== canonical.length) return undefined;
  return Object.freeze(canonical);
}

function isProcessId(value: unknown): value is number {
  return isRuntimeHostProcessId(value);
}

function isShutdownDeadline(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 60_000;
}

function isShutdownReason(value: unknown): value is RuntimeHostShutdownReason {
  return Object.values(RuntimeHostShutdownReason).includes(value as RuntimeHostShutdownReason);
}

function isLoopbackHttpOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    const port = Number(parsed.port);
    return (
      parsed.protocol === "http:" &&
      parsed.hostname === "127.0.0.1" &&
      Number.isInteger(port) &&
      port >= 1 &&
      port <= 65_535 &&
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

function startupErrorMessage(code: RuntimeHostStartupErrorCode): string {
  switch (code) {
    case RuntimeHostStartupErrorCode.invalidControlFrame:
      return "Runtime Host control input is invalid.";
    case RuntimeHostStartupErrorCode.unsupportedControlVersion:
      return "Runtime Host control protocol version is unsupported.";
    case RuntimeHostStartupErrorCode.startupFailed:
      return "Runtime Host startup failed.";
  }
}

export function parseRuntimeHostStartFrame(value: unknown): RuntimeHostStartFrame | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["type", "controlVersion", "authMode", "accessToken", "allowedOrigins"]) ||
    value.type !== "start" ||
    value.controlVersion !== RUNTIME_HOST_CONTROL_VERSION ||
    value.authMode !== "desktop-sidecar" ||
    !isCredentialSafeString(value.accessToken, 8_192)
  ) {
    return undefined;
  }
  const allowedOrigins = parseAllowedOrigins(value.allowedOrigins);
  if (!allowedOrigins) return undefined;
  return Object.freeze({
    type: "start",
    controlVersion: RUNTIME_HOST_CONTROL_VERSION,
    authMode: "desktop-sidecar",
    accessToken: value.accessToken,
    allowedOrigins,
  });
}

export function parseRuntimeHostShutdownFrame(
  value: unknown,
): RuntimeHostShutdownFrame | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["type", "controlVersion", "reason", "deadlineMs"]) ||
    value.type !== "shutdown" ||
    value.controlVersion !== RUNTIME_HOST_CONTROL_VERSION ||
    !isShutdownReason(value.reason) ||
    !isShutdownDeadline(value.deadlineMs)
  ) {
    return undefined;
  }
  return Object.freeze({
    type: "shutdown",
    controlVersion: RUNTIME_HOST_CONTROL_VERSION,
    reason: value.reason,
    deadlineMs: value.deadlineMs,
  });
}

export function parseRuntimeHostControlInputFrame(
  value: unknown,
): RuntimeHostControlInputFrame | undefined {
  return parseRuntimeHostStartFrame(value) ?? parseRuntimeHostShutdownFrame(value);
}

export function runtimeHostControlInputErrorCode(
  value: unknown,
):
  | typeof RuntimeHostStartupErrorCode.invalidControlFrame
  | typeof RuntimeHostStartupErrorCode.unsupportedControlVersion {
  return isRecord(value) &&
    Number.isSafeInteger(value.controlVersion) &&
    value.controlVersion !== RUNTIME_HOST_CONTROL_VERSION
    ? RuntimeHostStartupErrorCode.unsupportedControlVersion
    : RuntimeHostStartupErrorCode.invalidControlFrame;
}

export function parseRuntimeHostReadyFrame(value: unknown): RuntimeHostReadyFrame | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "type",
      "controlVersion",
      "hostProtocolVersion",
      "instanceId",
      "pid",
      "httpOrigin",
    ]) ||
    value.type !== "ready" ||
    value.controlVersion !== RUNTIME_HOST_CONTROL_VERSION ||
    value.hostProtocolVersion !== RUNTIME_HOST_PROTOCOL_VERSION ||
    !isCredentialSafeString(value.instanceId, 512) ||
    !isProcessId(value.pid) ||
    !isLoopbackHttpOrigin(value.httpOrigin)
  ) {
    return undefined;
  }
  return Object.freeze({
    type: "ready",
    controlVersion: RUNTIME_HOST_CONTROL_VERSION,
    hostProtocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
    instanceId: value.instanceId,
    pid: value.pid,
    httpOrigin: value.httpOrigin,
  });
}

export function parseRuntimeHostStartupErrorFrame(
  value: unknown,
): RuntimeHostStartupErrorFrame | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["type", "controlVersion", "code", "message"]) ||
    value.type !== "startup-error" ||
    value.controlVersion !== RUNTIME_HOST_CONTROL_VERSION ||
    !Object.values(RuntimeHostStartupErrorCode).includes(value.code as RuntimeHostStartupErrorCode)
  ) {
    return undefined;
  }
  const code = value.code as RuntimeHostStartupErrorCode;
  if (value.message !== startupErrorMessage(code)) return undefined;
  return Object.freeze({
    type: "startup-error",
    controlVersion: RUNTIME_HOST_CONTROL_VERSION,
    code,
    message: startupErrorMessage(code),
  });
}

export function parseRuntimeHostShutdownAckFrame(
  value: unknown,
): RuntimeHostShutdownAckFrame | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["type", "controlVersion"]) ||
    value.type !== "shutdown-ack" ||
    value.controlVersion !== RUNTIME_HOST_CONTROL_VERSION
  ) {
    return undefined;
  }
  return Object.freeze({
    type: "shutdown-ack",
    controlVersion: RUNTIME_HOST_CONTROL_VERSION,
  });
}

export function parseRuntimeHostControlOutputFrame(
  value: unknown,
): RuntimeHostControlOutputFrame | undefined {
  return (
    parseRuntimeHostReadyFrame(value) ??
    parseRuntimeHostStartupErrorFrame(value) ??
    parseRuntimeHostShutdownAckFrame(value)
  );
}

export function createRuntimeHostStartFrame(
  value: Omit<RuntimeHostStartFrame, "type" | "controlVersion" | "authMode">,
): RuntimeHostStartFrame {
  const frame = parseRuntimeHostStartFrame({
    type: "start",
    controlVersion: RUNTIME_HOST_CONTROL_VERSION,
    authMode: "desktop-sidecar",
    ...value,
  });
  if (!frame) throw new Error("Invalid Runtime Host start frame.");
  return frame;
}

export function createRuntimeHostShutdownFrame(
  value: Omit<RuntimeHostShutdownFrame, "type" | "controlVersion">,
): RuntimeHostShutdownFrame {
  const frame = parseRuntimeHostShutdownFrame({
    type: "shutdown",
    controlVersion: RUNTIME_HOST_CONTROL_VERSION,
    ...value,
  });
  if (!frame) throw new Error("Invalid Runtime Host shutdown frame.");
  return frame;
}

export function createRuntimeHostReadyFrame(
  value: Omit<RuntimeHostReadyFrame, "type" | "controlVersion" | "hostProtocolVersion">,
): RuntimeHostReadyFrame {
  const frame = parseRuntimeHostReadyFrame({
    type: "ready",
    controlVersion: RUNTIME_HOST_CONTROL_VERSION,
    hostProtocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
    ...value,
  });
  if (!frame) throw new Error("Invalid Runtime Host ready frame.");
  return frame;
}

export function createRuntimeHostStartupErrorFrame(
  code: RuntimeHostStartupErrorCode,
): RuntimeHostStartupErrorFrame {
  const frame = parseRuntimeHostStartupErrorFrame({
    type: "startup-error",
    controlVersion: RUNTIME_HOST_CONTROL_VERSION,
    code,
    message: startupErrorMessage(code),
  });
  if (!frame) throw new Error("Invalid Runtime Host startup error code.");
  return frame;
}

export function createRuntimeHostShutdownAckFrame(): RuntimeHostShutdownAckFrame {
  return Object.freeze({
    type: "shutdown-ack",
    controlVersion: RUNTIME_HOST_CONTROL_VERSION,
  });
}

export function encodeRuntimeHostControlInputFrame(frame: unknown): string {
  const parsed = parseRuntimeHostControlInputFrame(frame);
  if (!parsed) throw new Error("Invalid Runtime Host control input frame.");
  return encodeControlNdjsonFrame(parsed, RUNTIME_HOST_CONTROL_MAX_FRAME_BYTES);
}

export function encodeRuntimeHostControlOutputFrame(frame: unknown): string {
  const parsed = parseRuntimeHostControlOutputFrame(frame);
  if (!parsed) throw new Error("Invalid Runtime Host control output frame.");
  return encodeControlNdjsonFrame(parsed, RUNTIME_HOST_CONTROL_MAX_FRAME_BYTES);
}

export class RuntimeHostControlNdjsonDecoder {
  readonly #decoder = new ControlNdjsonDecoder({
    maximumFrameBytes: RUNTIME_HOST_CONTROL_MAX_FRAME_BYTES,
    createError: (code) => new RuntimeHostControlDecodeError(code),
  });

  push(chunk: Uint8Array): readonly unknown[] {
    return this.#decoder.push(chunk);
  }

  finish(): void {
    this.#decoder.finish();
  }
}
