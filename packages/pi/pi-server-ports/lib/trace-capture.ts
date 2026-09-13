import type {
  SessionContextTraceJsonValue,
  SessionContextTraceJsonCapture,
  SessionContextTraceTextCapture,
} from "@workbench/pi-protocol/rpc";
export function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}
export function jsonBytes(value: unknown): number {
  const seen = new WeakSet<object>();
  try {
    const serialized = JSON.stringify(value, (_key, current: unknown) => {
      if (typeof current === "bigint") return current.toString();
      if (typeof current === "function") return `[Function ${current.name || "anonymous"}]`;
      if (typeof current === "symbol") return current.toString();
      if (typeof current !== "object" || current === null) return current;
      if (seen.has(current)) return "[Circular]";
      seen.add(current);
      return current;
    });
    return serialized === undefined ? 0 : byteLength(serialized);
  } catch {
    return 0;
  }
}
export function captureJsonValue(
  value: unknown,
  ancestors: WeakSet<object>,
): SessionContextTraceJsonValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined") return "[Undefined]";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return captureJsonValue(
      { name: value.name, message: value.message, stack: value.stack },
      ancestors,
    );
  }

  if (ancestors.has(value)) return "[Circular]";
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => captureJsonValue(item, ancestors));
    }

    const result: Record<string, SessionContextTraceJsonValue> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      result[entryKey] = captureJsonValue(entryValue, ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}
export function captureSessionContextTraceJson(value: unknown): SessionContextTraceJsonCapture {
  const captured = captureJsonValue(value, new WeakSet());
  const capturedBytes = jsonBytes(captured);
  return {
    value: captured,
    capture: {
      originalBytes: jsonBytes(value),
      capturedBytes,
      truncated: false,
      redactedPaths: [],
    },
  };
}
export function captureSessionContextTraceText(value: string): SessionContextTraceTextCapture {
  return {
    text: value,
    originalCharacters: value.length,
    originalBytes: byteLength(value),
    capturedBytes: byteLength(value),
    truncated: false,
    redactedPaths: [],
  };
}
export function captureSessionContextTraceHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  return { ...headers };
}
