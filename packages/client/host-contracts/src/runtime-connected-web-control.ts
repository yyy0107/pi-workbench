import {
  parseRuntimeConnection,
  type DesktopSidecarRuntimeConnection,
} from "@workbench/host-contracts/runtime-connection";

export const RUNTIME_CONNECTED_WEB_CONTROL_VERSION = 1 as const;
export const RUNTIME_CONNECTED_WEB_START_MESSAGE_TYPE =
  "workbench:runtime-connected-web-start" as const;

export const RuntimeConnectedWebMode = Object.freeze({
  development: "development",
  production: "production",
} as const);

export type RuntimeConnectedWebMode =
  (typeof RuntimeConnectedWebMode)[keyof typeof RuntimeConnectedWebMode];

/** Root-to-Web IPC configuration. This is the only browser-host DTO containing the token. */
export interface RuntimeConnectedWebStartMessage {
  readonly type: typeof RUNTIME_CONNECTED_WEB_START_MESSAGE_TYPE;
  readonly version: typeof RUNTIME_CONNECTED_WEB_CONTROL_VERSION;
  readonly mode: RuntimeConnectedWebMode;
  readonly publicOrigin: string;
  readonly runtimeConnection: DesktopSidecarRuntimeConnection;
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

function isControlString(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 32 || codePoint === 127);
    })
  );
}

/** Accepts only the canonical `http://127.0.0.1:<port>` spelling used by root orchestration. */
export function parseCanonicalLoopbackHttpOrigin(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2_048 || value.trim() !== value) {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    const port = Number(parsed.port);
    if (
      parsed.protocol !== "http:" ||
      parsed.hostname !== "127.0.0.1" ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65_535 ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.origin !== value
    ) {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

/** Parses an exact immutable message and never reflects credential-bearing input in errors. */
export function parseRuntimeConnectedWebStartMessage(
  value: unknown,
): RuntimeConnectedWebStartMessage | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["type", "version", "mode", "publicOrigin", "runtimeConnection"]) ||
    value.type !== RUNTIME_CONNECTED_WEB_START_MESSAGE_TYPE ||
    value.version !== RUNTIME_CONNECTED_WEB_CONTROL_VERSION ||
    !Object.values(RuntimeConnectedWebMode).includes(value.mode as RuntimeConnectedWebMode)
  ) {
    return undefined;
  }
  const publicOrigin = parseCanonicalLoopbackHttpOrigin(value.publicOrigin);
  const runtimeConnection = parseRuntimeConnection(value.runtimeConnection);
  if (
    !publicOrigin ||
    runtimeConnection?.kind !== "desktop-sidecar" ||
    !parseCanonicalLoopbackHttpOrigin(runtimeConnection.httpOrigin) ||
    runtimeConnection.httpOrigin === publicOrigin ||
    !isControlString(runtimeConnection.instanceId, 512) ||
    !isControlString(runtimeConnection.accessToken, 8_192)
  ) {
    return undefined;
  }
  return Object.freeze({
    type: RUNTIME_CONNECTED_WEB_START_MESSAGE_TYPE,
    version: RUNTIME_CONNECTED_WEB_CONTROL_VERSION,
    mode: value.mode as RuntimeConnectedWebMode,
    publicOrigin,
    runtimeConnection: Object.freeze({ ...runtimeConnection }),
  });
}

export function createRuntimeConnectedWebStartMessage(
  value: Omit<RuntimeConnectedWebStartMessage, "type" | "version">,
): RuntimeConnectedWebStartMessage {
  const message = parseRuntimeConnectedWebStartMessage({
    type: RUNTIME_CONNECTED_WEB_START_MESSAGE_TYPE,
    version: RUNTIME_CONNECTED_WEB_CONTROL_VERSION,
    ...value,
  });
  if (!message) throw new Error("Invalid Runtime-connected Web start message.");
  return message;
}
