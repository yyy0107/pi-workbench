/**
 * Container-neutral color data consumed by a desktop title-bar implementation.
 * Values deliberately match Electron's `titleBarOverlay` color representation
 * without importing or depending on Electron.
 */
export interface TitleBarOverlay {
  readonly color: string;
  readonly symbolColor: string;
}

/** The narrow desktop capability needed by Workbench's title-bar appearance sync. */
export interface DesktopTitleBarPort {
  setOverlay(overlay: TitleBarOverlay): void;
}

const OPAQUE_HEX_COLOR_PATTERN = /^#[\da-f]{6}$/i;

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

function isOpaqueHexColor(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_HEX_COLOR_PATTERN.test(value);
}

/**
 * Converts untrusted bridge input into an immutable title-bar payload. The
 * narrow color grammar prevents arbitrary objects or transparent colors from
 * crossing a desktop bridge.
 */
export function parseTitleBarOverlay(value: unknown): TitleBarOverlay | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["color", "symbolColor"]) ||
    !isOpaqueHexColor(value.color) ||
    !isOpaqueHexColor(value.symbolColor)
  ) {
    return undefined;
  }

  return Object.freeze({ color: value.color, symbolColor: value.symbolColor });
}

/** Defines an immutable, validated title-bar payload. */
export function defineTitleBarOverlay(value: unknown): TitleBarOverlay {
  const overlay = parseTitleBarOverlay(value);
  if (!overlay) throw new Error("Invalid desktop title-bar overlay.");
  return overlay;
}

export function isTitleBarOverlay(value: unknown): value is TitleBarOverlay {
  return parseTitleBarOverlay(value) !== undefined;
}
