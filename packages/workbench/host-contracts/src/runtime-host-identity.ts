import { RUNTIME_CONNECTION_PROTOCOL_VERSION } from "@workbench/host-contracts/runtime-connection";

export const RUNTIME_HOST_PROTOCOL_VERSION = RUNTIME_CONNECTION_PROTOCOL_VERSION;
export const RUNTIME_HOST_HEALTH_PATH = "/api/health" as const;
export const RUNTIME_HOST_IDENTITY_PATH = "/api/identity" as const;
export const RUNTIME_HOST_PRODUCT = "workbench-runtime-host" as const;

export interface RuntimeHostHealth {
  readonly status: "ok";
  readonly hostProtocolVersion: typeof RUNTIME_HOST_PROTOCOL_VERSION;
  readonly instanceId: string;
}

export interface RuntimeHostIdentity {
  readonly product: typeof RUNTIME_HOST_PRODUCT;
  readonly hostProtocolVersion: typeof RUNTIME_HOST_PROTOCOL_VERSION;
  readonly instanceId: string;
  readonly pid: number;
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

export function isRuntimeHostCredentialSafeString(
  value: unknown,
  maximumLength: number,
): value is string {
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

export function isRuntimeHostProcessId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function createRuntimeHostHealth(instanceId: string): RuntimeHostHealth {
  if (!isRuntimeHostCredentialSafeString(instanceId, 512)) {
    throw new Error("Invalid Runtime Host health identity.");
  }
  return Object.freeze({
    status: "ok",
    hostProtocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
    instanceId,
  });
}

export function parseRuntimeHostHealth(value: unknown): RuntimeHostHealth | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["status", "hostProtocolVersion", "instanceId"]) ||
    value.status !== "ok" ||
    value.hostProtocolVersion !== RUNTIME_HOST_PROTOCOL_VERSION ||
    !isRuntimeHostCredentialSafeString(value.instanceId, 512)
  ) {
    return undefined;
  }
  return createRuntimeHostHealth(value.instanceId);
}

export function createRuntimeHostIdentity(
  value: Pick<RuntimeHostIdentity, "instanceId" | "pid">,
): RuntimeHostIdentity {
  if (
    !isRuntimeHostCredentialSafeString(value.instanceId, 512) ||
    !isRuntimeHostProcessId(value.pid)
  ) {
    throw new Error("Invalid Runtime Host identity.");
  }
  return Object.freeze({
    product: RUNTIME_HOST_PRODUCT,
    hostProtocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
    instanceId: value.instanceId,
    pid: value.pid,
  });
}

export function parseRuntimeHostIdentity(value: unknown): RuntimeHostIdentity | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["product", "hostProtocolVersion", "instanceId", "pid"]) ||
    value.product !== RUNTIME_HOST_PRODUCT ||
    value.hostProtocolVersion !== RUNTIME_HOST_PROTOCOL_VERSION ||
    !isRuntimeHostCredentialSafeString(value.instanceId, 512) ||
    !isRuntimeHostProcessId(value.pid)
  ) {
    return undefined;
  }
  return createRuntimeHostIdentity({ instanceId: value.instanceId, pid: value.pid });
}
