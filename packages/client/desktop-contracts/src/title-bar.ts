import { isRecord, hasOnlyKeys, isOpaqueHexColor } from "../lib/title-bar-validation.ts";
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

/**
 * Converts untrusted bridge input into an immutable title-bar payload. The
 * narrow color grammar allows a transparent background while keeping symbols
 * opaque and rejecting arbitrary CSS at the desktop bridge.
 */
export function parseTitleBarOverlay(value: unknown): TitleBarOverlay | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["color", "symbolColor"]) ||
    (value.color !== "#00000000" && !isOpaqueHexColor(value.color)) ||
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
