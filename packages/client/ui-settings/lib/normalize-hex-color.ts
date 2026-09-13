export function normalizeHexColor(value: string): string | undefined {
  const hex = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim())?.[1];
  if (!hex) return undefined;
  return `#${hex.length === 3 ? [...hex].map((digit) => digit.repeat(2)).join("") : hex}`.toLowerCase();
}
