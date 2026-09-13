import type { WorkbenchSettingsJsonValue } from "@workbench/agent-runtime-contracts/settings";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonValue(value: unknown, depth = 0): value is WorkbenchSettingsJsonValue {
  if (depth > 32) return false;
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  return isRecord(value) && Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

export function shortString(value: unknown, field: string, maximumLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximumLength) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}

export function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 1_000) throw new TypeError(`${field} is invalid`);
  const items = value.map((item) => shortString(item, field, 512));
  return [...new Set(items)];
}
