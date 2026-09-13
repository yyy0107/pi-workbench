export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasContentIndex(value: Record<string, unknown>): boolean {
  return Number.isInteger(value.contentIndex) && (value.contentIndex as number) >= 0;
}

export function hasOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}
