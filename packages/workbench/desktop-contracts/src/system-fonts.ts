/** Font family names from the local desktop host, independent of the connected Runtime. */
export interface DesktopSystemFontsPort {
  getFontFamilies(): Promise<readonly string[]>;
}

export function readDesktopSystemFontsPort(value: unknown): DesktopSystemFontsPort | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  if (typeof (value as { getFontFamilies?: unknown }).getFontFamilies !== "function")
    return undefined;
  return value as DesktopSystemFontsPort;
}
