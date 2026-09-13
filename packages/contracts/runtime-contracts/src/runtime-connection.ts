/**
 * Version negotiated by the Workbench Runtime Host transport. Connection
 * descriptors always use the version the renderer was built to understand.
 */
export const RUNTIME_CONNECTION_PROTOCOL_VERSION = 1 as const;

/** A wire version is intentionally numeric so a Host can report a mismatch. */
export type RuntimeProtocolVersion = number;

export interface SameOriginRuntimeConnection {
  readonly kind: "same-origin";
  readonly protocolVersion: typeof RUNTIME_CONNECTION_PROTOCOL_VERSION;
  readonly httpOrigin: string;
}

export interface DesktopSidecarRuntimeConnection {
  readonly kind: "desktop-sidecar";
  readonly protocolVersion: typeof RUNTIME_CONNECTION_PROTOCOL_VERSION;
  readonly httpOrigin: string;
  readonly instanceId: string;
  readonly accessToken: string;
}

/**
 * A JSON-safe, immutable description of where a renderer reaches its Runtime
 * Host. The token is present only for the in-memory desktop bootstrap path.
 */
export type RuntimeConnection = SameOriginRuntimeConnection | DesktopSidecarRuntimeConnection;

export const RuntimeWebSocketCloseCode = Object.freeze({
  invalidAuthenticationFrame: 4400,
  authenticationFailed: 4401,
  authenticationTimeout: 4408,
  protocolVersionMismatch: 4409,
} as const);

export type RuntimeWebSocketCloseCode =
  (typeof RuntimeWebSocketCloseCode)[keyof typeof RuntimeWebSocketCloseCode];

export const RuntimeWebSocketAuthenticationErrorCode = Object.freeze({
  invalidFrame: "invalid-frame",
  authenticationFailed: "authentication-failed",
  authenticationTimedOut: "authentication-timed-out",
  protocolVersionMismatch: "protocol-version-mismatch",
} as const);

export type RuntimeWebSocketAuthenticationErrorCode =
  (typeof RuntimeWebSocketAuthenticationErrorCode)[keyof typeof RuntimeWebSocketAuthenticationErrorCode];

/** The versioned first frame required by a desktop-sidecar WebSocket. */
export interface RuntimeWebSocketAuthenticateFrame {
  readonly type: "authenticate";
  readonly protocolVersion: RuntimeProtocolVersion;
  readonly instanceId: string;
  readonly accessToken: string;
}

/** Host acknowledgement emitted before normal Pi or terminal frames begin. */
export interface RuntimeWebSocketAuthenticatedFrame {
  readonly type: "authenticated";
  readonly protocolVersion: RuntimeProtocolVersion;
  readonly instanceId: string;
}

/** A serializable diagnostic frame that never contains a credential. */
export interface RuntimeWebSocketAuthenticationErrorFrame {
  readonly type: "error";
  readonly protocolVersion: RuntimeProtocolVersion;
  readonly code: RuntimeWebSocketAuthenticationErrorCode;
  readonly message: string;
}

export type RuntimeWebSocketAuthenticationFrame =
  | RuntimeWebSocketAuthenticateFrame
  | RuntimeWebSocketAuthenticatedFrame
  | RuntimeWebSocketAuthenticationErrorFrame;

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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isProtocolVersion(value: unknown): value is RuntimeProtocolVersion {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function freezeConnection(connection: RuntimeConnection): RuntimeConnection {
  return Object.freeze(connection);
}

function freezeAuthenticationFrame(
  frame: RuntimeWebSocketAuthenticationFrame,
): RuntimeWebSocketAuthenticationFrame {
  return Object.freeze(frame);
}

/** Parses a connection descriptor and returns a new immutable, JSON-safe value. */
export function parseRuntimeConnection(value: unknown): RuntimeConnection | undefined {
  try {
    if (!isRecord(value) || !isProtocolVersion(value.protocolVersion)) return undefined;
    if (value.protocolVersion !== RUNTIME_CONNECTION_PROTOCOL_VERSION) return undefined;
    if (!isNonEmptyString(value.httpOrigin)) return undefined;

    if (value.kind === "same-origin") {
      if (!hasOnlyKeys(value, ["kind", "protocolVersion", "httpOrigin"])) return undefined;
      return freezeConnection({
        kind: "same-origin",
        protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
        httpOrigin: value.httpOrigin,
      });
    }

    if (value.kind === "desktop-sidecar") {
      if (
        !hasOnlyKeys(value, [
          "kind",
          "protocolVersion",
          "httpOrigin",
          "instanceId",
          "accessToken",
        ]) ||
        !isNonEmptyString(value.instanceId) ||
        !isNonEmptyString(value.accessToken)
      ) {
        return undefined;
      }
      return freezeConnection({
        kind: "desktop-sidecar",
        protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
        httpOrigin: value.httpOrigin,
        instanceId: value.instanceId,
        accessToken: value.accessToken,
      });
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/** Throws a credential-safe error for an invalid connection bootstrap value. */
export function defineRuntimeConnection(value: unknown): RuntimeConnection {
  const connection = parseRuntimeConnection(value);
  if (!connection) throw new Error("Invalid Runtime connection descriptor.");
  return connection;
}

export function isRuntimeConnection(value: unknown): value is RuntimeConnection {
  return parseRuntimeConnection(value) !== undefined;
}

export function isRuntimeProtocolVersionCompatible(version: unknown): boolean {
  return version === RUNTIME_CONNECTION_PROTOCOL_VERSION;
}

export function isRuntimeWebSocketCloseCode(value: unknown): value is RuntimeWebSocketCloseCode {
  return Object.values(RuntimeWebSocketCloseCode).includes(value as RuntimeWebSocketCloseCode);
}

export function parseRuntimeWebSocketAuthenticateFrame(
  value: unknown,
): RuntimeWebSocketAuthenticateFrame | undefined {
  try {
    if (
      !isRecord(value) ||
      !hasOnlyKeys(value, ["type", "protocolVersion", "instanceId", "accessToken"]) ||
      value.type !== "authenticate" ||
      !isProtocolVersion(value.protocolVersion) ||
      !isNonEmptyString(value.instanceId) ||
      !isNonEmptyString(value.accessToken)
    ) {
      return undefined;
    }
    return freezeAuthenticationFrame({
      type: "authenticate",
      protocolVersion: value.protocolVersion,
      instanceId: value.instanceId,
      accessToken: value.accessToken,
    }) as RuntimeWebSocketAuthenticateFrame;
  } catch {
    return undefined;
  }
}

export function parseRuntimeWebSocketAuthenticatedFrame(
  value: unknown,
): RuntimeWebSocketAuthenticatedFrame | undefined {
  try {
    if (
      !isRecord(value) ||
      !hasOnlyKeys(value, ["type", "protocolVersion", "instanceId"]) ||
      value.type !== "authenticated" ||
      !isProtocolVersion(value.protocolVersion) ||
      !isNonEmptyString(value.instanceId)
    ) {
      return undefined;
    }
    return freezeAuthenticationFrame({
      type: "authenticated",
      protocolVersion: value.protocolVersion,
      instanceId: value.instanceId,
    }) as RuntimeWebSocketAuthenticatedFrame;
  } catch {
    return undefined;
  }
}

export function parseRuntimeWebSocketAuthenticationErrorFrame(
  value: unknown,
): RuntimeWebSocketAuthenticationErrorFrame | undefined {
  try {
    if (
      !isRecord(value) ||
      !hasOnlyKeys(value, ["type", "protocolVersion", "code", "message"]) ||
      value.type !== "error" ||
      !isProtocolVersion(value.protocolVersion) ||
      !Object.values(RuntimeWebSocketAuthenticationErrorCode).includes(
        value.code as RuntimeWebSocketAuthenticationErrorCode,
      ) ||
      !isNonEmptyString(value.message)
    ) {
      return undefined;
    }
    return freezeAuthenticationFrame({
      type: "error",
      protocolVersion: value.protocolVersion,
      code: value.code as RuntimeWebSocketAuthenticationErrorCode,
      message: value.message,
    }) as RuntimeWebSocketAuthenticationErrorFrame;
  } catch {
    return undefined;
  }
}

/** Parses exactly one of the control frames owned by the Runtime transport. */
export function parseRuntimeWebSocketAuthenticationFrame(
  value: unknown,
): RuntimeWebSocketAuthenticationFrame | undefined {
  return (
    parseRuntimeWebSocketAuthenticateFrame(value) ??
    parseRuntimeWebSocketAuthenticatedFrame(value) ??
    parseRuntimeWebSocketAuthenticationErrorFrame(value)
  );
}

export function isRuntimeWebSocketAuthenticateFrame(
  value: unknown,
): value is RuntimeWebSocketAuthenticateFrame {
  return parseRuntimeWebSocketAuthenticateFrame(value) !== undefined;
}

export function isRuntimeWebSocketAuthenticatedFrame(
  value: unknown,
): value is RuntimeWebSocketAuthenticatedFrame {
  return parseRuntimeWebSocketAuthenticatedFrame(value) !== undefined;
}

export function isRuntimeWebSocketAuthenticationErrorFrame(
  value: unknown,
): value is RuntimeWebSocketAuthenticationErrorFrame {
  return parseRuntimeWebSocketAuthenticationErrorFrame(value) !== undefined;
}

export function createRuntimeWebSocketAuthenticateFrame(
  connection: DesktopSidecarRuntimeConnection,
): RuntimeWebSocketAuthenticateFrame {
  return Object.freeze({
    type: "authenticate",
    protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
    instanceId: connection.instanceId,
    accessToken: connection.accessToken,
  });
}

/** Creates the credential-free acknowledgement emitted before business frames. */
export function createRuntimeWebSocketAuthenticatedFrame(
  instanceId: string,
): RuntimeWebSocketAuthenticatedFrame {
  if (!isNonEmptyString(instanceId)) {
    throw new Error("Invalid Runtime WebSocket authentication acknowledgement.");
  }
  return Object.freeze({
    type: "authenticated",
    protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
    instanceId,
  });
}

function authenticationErrorMessage(code: RuntimeWebSocketAuthenticationErrorCode): string {
  switch (code) {
    case "invalid-frame":
      return "Runtime WebSocket authentication frame is invalid.";
    case "authentication-failed":
      return "Runtime WebSocket authentication failed.";
    case "authentication-timed-out":
      return "Runtime WebSocket authentication timed out.";
    case "protocol-version-mismatch":
      return "Runtime WebSocket protocol version is incompatible.";
  }
}

/**
 * Creates a stable credential-free error frame. Callers choose only a public
 * error code, so a token or raw authentication frame cannot leak into the
 * diagnostic message by accident.
 */
export function createRuntimeWebSocketAuthenticationErrorFrame(
  code: RuntimeWebSocketAuthenticationErrorCode,
): RuntimeWebSocketAuthenticationErrorFrame {
  if (!Object.values(RuntimeWebSocketAuthenticationErrorCode).includes(code)) {
    throw new Error("Invalid Runtime WebSocket authentication error code.");
  }
  return Object.freeze({
    type: "error",
    protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
    code,
    message: authenticationErrorMessage(code),
  });
}
