export const OPAQUE_HEX_COLOR_PATTERN = /^#[\da-f]{6}$/i;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasOnlyKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

export function isOpaqueHexColor(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_HEX_COLOR_PATTERN.test(value);
}
