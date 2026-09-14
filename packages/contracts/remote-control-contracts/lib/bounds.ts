import { canonicalJson } from "./canonical-json";

export { canonicalJson } from "./canonical-json";

export const REMOTE_PROTOCOL_LIMITS = Object.freeze({
  authenticationFrameBytes: 16 * 1024,
  sealedEnvelopeBytes: 256 * 1024,
  commandPlaintextBytes: 128 * 1024,
  textPromptBytes: 64 * 1024,
  titleBytes: 512,
  identifierBytes: 128,
  errorDetailsBytes: 4 * 1024,
  activitySummaryBytes: 2 * 1024,
  assistantTextBytes: 96 * 1024,
  toolArgumentsBytes: 64 * 1024,
  toolOutputBytes: 128 * 1024,
  answerAggregateBytes: 16 * 1024,
  catalogPageBytes: 192 * 1024,
  catalogPageItems: 100,
  historyPageBytes: 192 * 1024,
  historyPageItems: 50,
  deltaBytes: 16 * 1024,
  jsonDepth: 16,
  arrayItems: 1_000,
  objectKeys: 256,
});

const ASCII_IDENTIFIER = /^[\x21-\x7e]+$/u;
const RFC_3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;
const MAX_UINT64 = BigInt("18446744073709551615");

export function remoteUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function isRemotePlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function hasOnlyKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

export function isBoundedString(
  value: unknown,
  maximumBytes: number,
  { allowEmpty = false }: { readonly allowEmpty?: boolean } = {},
): value is string {
  return (
    typeof value === "string" &&
    (allowEmpty || value.length > 0) &&
    remoteUtf8ByteLength(value) <= maximumBytes
  );
}

export function isRemoteIdentifier(value: unknown): value is string {
  return (
    isBoundedString(value, REMOTE_PROTOCOL_LIMITS.identifierBytes) && ASCII_IDENTIFIER.test(value)
  );
}

export function isRemoteTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 40 &&
    RFC_3339_UTC.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function isRemoteCursorOffset(value: unknown): value is string {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value)) return false;
  try {
    return BigInt(value) <= MAX_UINT64;
  } catch {
    return false;
  }
}

export function isJsonValueWithinLimits(
  value: unknown,
  options: {
    readonly maximumBytes: number;
    readonly maximumDepth?: number;
    readonly maximumArrayItems?: number;
    readonly maximumObjectKeys?: number;
  },
): boolean {
  const maximumDepth = options.maximumDepth ?? REMOTE_PROTOCOL_LIMITS.jsonDepth;
  const maximumArrayItems = options.maximumArrayItems ?? REMOTE_PROTOCOL_LIMITS.arrayItems;
  const maximumObjectKeys = options.maximumObjectKeys ?? REMOTE_PROTOCOL_LIMITS.objectKeys;
  const visit = (entry: unknown, depth: number): boolean => {
    if (depth > maximumDepth) return false;
    if (entry === null || typeof entry === "string" || typeof entry === "boolean") return true;
    if (typeof entry === "number") return Number.isFinite(entry);
    if (Array.isArray(entry)) {
      return entry.length <= maximumArrayItems && entry.every((item) => visit(item, depth + 1));
    }
    if (!isRemotePlainObject(entry)) return false;
    const entries = Object.entries(entry);
    return (
      entries.length <= maximumObjectKeys &&
      entries.every(([key, item]) => isBoundedString(key, 256) && visit(item, depth + 1))
    );
  };
  if (!visit(value, 0)) return false;
  try {
    return remoteUtf8ByteLength(canonicalJson(value)) <= options.maximumBytes;
  } catch {
    return false;
  }
}
