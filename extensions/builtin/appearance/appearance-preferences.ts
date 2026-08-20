export const APPEARANCE_STORAGE_KEY = "workbench.appearance.v1";

export const COLOR_MODES = ["system", "light", "dark"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

export const BACKGROUND_BLURS = ["none", "soft", "medium", "strong"] as const;
export type BackgroundBlur = (typeof BACKGROUND_BLURS)[number];

export const MIN_SURFACE_OPACITY = 0;
export const MAX_SURFACE_OPACITY = 100;
export type SurfaceOpacity = number;

export const GLASS_BLURS = ["none", "soft", "medium", "strong"] as const;
export type GlassBlur = (typeof GLASS_BLURS)[number];

export const BORDER_STYLES = ["default", "solid", "dashed", "dotted", "none"] as const;
export type BorderStyle = (typeof BORDER_STYLES)[number];

export const CORNER_RADIUS_STYLES = ["default", "square", "compact", "rounded"] as const;
export type CornerRadiusStyle = (typeof CORNER_RADIUS_STYLES)[number];

export const UI_FONT_FAMILIES = ["system", "geist", "serif", "rounded"] as const;
export type UiFontFamily = (typeof UI_FONT_FAMILIES)[number];

export const CODE_FONT_FAMILIES = ["geistMono", "systemMono", "compactMono"] as const;
export type CodeFontFamily = (typeof CODE_FONT_FAMILIES)[number];

export const MIN_THEME_CONTRAST = 75;
export const MAX_THEME_CONTRAST = 125;
export type ThemeContrast = number;

export const MIN_UI_FONT_SIZE = 12;
export const MAX_UI_FONT_SIZE = 20;
export type UiFontSize = number;

export const MIN_CODE_FONT_SIZE = 10;
export const MAX_CODE_FONT_SIZE = 18;
export type CodeFontSize = number;

export interface AppearancePreferences {
  colorMode: ColorMode;
  customBackground: boolean;
  backgroundColor: string;
  backgroundBlur: BackgroundBlur;
  syncSurfaceColors: boolean;
  surfaceOpacity: SurfaceOpacity;
  glassBlur: GlassBlur;
  borderStyle: BorderStyle;
  customBorderColor: boolean;
  borderColor: string;
  cornerRadius: CornerRadiusStyle;
  lightAccentColor: string;
  lightBackgroundColor: string;
  lightForegroundColor: string;
  lightUiFont: UiFontFamily;
  lightCodeFont: CodeFontFamily;
  lightContrast: ThemeContrast;
  darkAccentColor: string;
  darkBackgroundColor: string;
  darkForegroundColor: string;
  darkUiFont: UiFontFamily;
  darkCodeFont: CodeFontFamily;
  darkContrast: ThemeContrast;
  usePointerCursor: boolean;
  reduceMotion: boolean;
  uiFontSize: UiFontSize;
  codeFontSize: CodeFontSize;
  showDiffMarkers: boolean;
}

export const DEFAULT_APPEARANCE_PREFERENCES = Object.freeze({
  colorMode: "system",
  customBackground: false,
  backgroundColor: "#f4f6fa",
  backgroundBlur: "none",
  syncSurfaceColors: true,
  surfaceOpacity: 80,
  glassBlur: "none",
  borderStyle: "default",
  customBorderColor: false,
  borderColor: "#d7dce5",
  cornerRadius: "default",
  lightAccentColor: "#18181b",
  lightBackgroundColor: "#ffffff",
  lightForegroundColor: "#18181b",
  lightUiFont: "geist",
  lightCodeFont: "geistMono",
  lightContrast: 100,
  darkAccentColor: "#f4f4f5",
  darkBackgroundColor: "#18181b",
  darkForegroundColor: "#fafafa",
  darkUiFont: "geist",
  darkCodeFont: "geistMono",
  darkContrast: 100,
  usePointerCursor: false,
  reduceMotion: false,
  uiFontSize: 16,
  codeFontSize: 13,
  showDiffMarkers: true,
} satisfies AppearancePreferences);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function isOneOf<T extends string | number>(value: unknown, options: readonly T[]): value is T {
  return options.includes(value as T);
}

function isSurfaceOpacity(value: unknown): value is SurfaceOpacity {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_SURFACE_OPACITY &&
    value <= MAX_SURFACE_OPACITY
  );
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum
  );
}

export function parseAppearancePreferences(serialized: string | null): AppearancePreferences {
  if (!serialized) return DEFAULT_APPEARANCE_PREFERENCES;

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return DEFAULT_APPEARANCE_PREFERENCES;
  }

  if (!isRecord(value)) return DEFAULT_APPEARANCE_PREFERENCES;

  return Object.freeze({
    colorMode: isOneOf(value.colorMode, COLOR_MODES)
      ? value.colorMode
      : DEFAULT_APPEARANCE_PREFERENCES.colorMode,
    customBackground:
      typeof value.customBackground === "boolean"
        ? value.customBackground
        : DEFAULT_APPEARANCE_PREFERENCES.customBackground,
    backgroundColor: isHexColor(value.backgroundColor)
      ? value.backgroundColor.toLowerCase()
      : DEFAULT_APPEARANCE_PREFERENCES.backgroundColor,
    backgroundBlur: isOneOf(value.backgroundBlur, BACKGROUND_BLURS)
      ? value.backgroundBlur
      : DEFAULT_APPEARANCE_PREFERENCES.backgroundBlur,
    syncSurfaceColors:
      typeof value.syncSurfaceColors === "boolean"
        ? value.syncSurfaceColors
        : DEFAULT_APPEARANCE_PREFERENCES.syncSurfaceColors,
    surfaceOpacity: isSurfaceOpacity(value.surfaceOpacity)
      ? value.surfaceOpacity
      : DEFAULT_APPEARANCE_PREFERENCES.surfaceOpacity,
    glassBlur: isOneOf(value.glassBlur, GLASS_BLURS)
      ? value.glassBlur
      : DEFAULT_APPEARANCE_PREFERENCES.glassBlur,
    borderStyle: isOneOf(value.borderStyle, BORDER_STYLES)
      ? value.borderStyle
      : DEFAULT_APPEARANCE_PREFERENCES.borderStyle,
    customBorderColor:
      typeof value.customBorderColor === "boolean"
        ? value.customBorderColor
        : DEFAULT_APPEARANCE_PREFERENCES.customBorderColor,
    borderColor: isHexColor(value.borderColor)
      ? value.borderColor.toLowerCase()
      : DEFAULT_APPEARANCE_PREFERENCES.borderColor,
    cornerRadius: isOneOf(value.cornerRadius, CORNER_RADIUS_STYLES)
      ? value.cornerRadius
      : DEFAULT_APPEARANCE_PREFERENCES.cornerRadius,
    lightAccentColor: isHexColor(value.lightAccentColor)
      ? value.lightAccentColor.toLowerCase()
      : DEFAULT_APPEARANCE_PREFERENCES.lightAccentColor,
    lightBackgroundColor: isHexColor(value.lightBackgroundColor)
      ? value.lightBackgroundColor.toLowerCase()
      : DEFAULT_APPEARANCE_PREFERENCES.lightBackgroundColor,
    lightForegroundColor: isHexColor(value.lightForegroundColor)
      ? value.lightForegroundColor.toLowerCase()
      : DEFAULT_APPEARANCE_PREFERENCES.lightForegroundColor,
    lightUiFont: isOneOf(value.lightUiFont, UI_FONT_FAMILIES)
      ? value.lightUiFont
      : DEFAULT_APPEARANCE_PREFERENCES.lightUiFont,
    lightCodeFont: isOneOf(value.lightCodeFont, CODE_FONT_FAMILIES)
      ? value.lightCodeFont
      : DEFAULT_APPEARANCE_PREFERENCES.lightCodeFont,
    lightContrast: isIntegerInRange(value.lightContrast, MIN_THEME_CONTRAST, MAX_THEME_CONTRAST)
      ? value.lightContrast
      : DEFAULT_APPEARANCE_PREFERENCES.lightContrast,
    darkAccentColor: isHexColor(value.darkAccentColor)
      ? value.darkAccentColor.toLowerCase()
      : DEFAULT_APPEARANCE_PREFERENCES.darkAccentColor,
    darkBackgroundColor: isHexColor(value.darkBackgroundColor)
      ? value.darkBackgroundColor.toLowerCase()
      : DEFAULT_APPEARANCE_PREFERENCES.darkBackgroundColor,
    darkForegroundColor: isHexColor(value.darkForegroundColor)
      ? value.darkForegroundColor.toLowerCase()
      : DEFAULT_APPEARANCE_PREFERENCES.darkForegroundColor,
    darkUiFont: isOneOf(value.darkUiFont, UI_FONT_FAMILIES)
      ? value.darkUiFont
      : DEFAULT_APPEARANCE_PREFERENCES.darkUiFont,
    darkCodeFont: isOneOf(value.darkCodeFont, CODE_FONT_FAMILIES)
      ? value.darkCodeFont
      : DEFAULT_APPEARANCE_PREFERENCES.darkCodeFont,
    darkContrast: isIntegerInRange(value.darkContrast, MIN_THEME_CONTRAST, MAX_THEME_CONTRAST)
      ? value.darkContrast
      : DEFAULT_APPEARANCE_PREFERENCES.darkContrast,
    usePointerCursor:
      typeof value.usePointerCursor === "boolean"
        ? value.usePointerCursor
        : DEFAULT_APPEARANCE_PREFERENCES.usePointerCursor,
    reduceMotion:
      typeof value.reduceMotion === "boolean"
        ? value.reduceMotion
        : DEFAULT_APPEARANCE_PREFERENCES.reduceMotion,
    uiFontSize: isIntegerInRange(value.uiFontSize, MIN_UI_FONT_SIZE, MAX_UI_FONT_SIZE)
      ? value.uiFontSize
      : DEFAULT_APPEARANCE_PREFERENCES.uiFontSize,
    codeFontSize: isIntegerInRange(value.codeFontSize, MIN_CODE_FONT_SIZE, MAX_CODE_FONT_SIZE)
      ? value.codeFontSize
      : DEFAULT_APPEARANCE_PREFERENCES.codeFontSize,
    showDiffMarkers:
      typeof value.showDiffMarkers === "boolean"
        ? value.showDiffMarkers
        : DEFAULT_APPEARANCE_PREFERENCES.showDiffMarkers,
  });
}

export function isDefaultAppearancePreferences(preferences: AppearancePreferences): boolean {
  return (
    preferences.colorMode === DEFAULT_APPEARANCE_PREFERENCES.colorMode &&
    preferences.customBackground === DEFAULT_APPEARANCE_PREFERENCES.customBackground &&
    preferences.backgroundColor === DEFAULT_APPEARANCE_PREFERENCES.backgroundColor &&
    preferences.backgroundBlur === DEFAULT_APPEARANCE_PREFERENCES.backgroundBlur &&
    preferences.syncSurfaceColors === DEFAULT_APPEARANCE_PREFERENCES.syncSurfaceColors &&
    preferences.surfaceOpacity === DEFAULT_APPEARANCE_PREFERENCES.surfaceOpacity &&
    preferences.glassBlur === DEFAULT_APPEARANCE_PREFERENCES.glassBlur &&
    preferences.borderStyle === DEFAULT_APPEARANCE_PREFERENCES.borderStyle &&
    preferences.customBorderColor === DEFAULT_APPEARANCE_PREFERENCES.customBorderColor &&
    preferences.borderColor === DEFAULT_APPEARANCE_PREFERENCES.borderColor &&
    preferences.cornerRadius === DEFAULT_APPEARANCE_PREFERENCES.cornerRadius &&
    preferences.lightAccentColor === DEFAULT_APPEARANCE_PREFERENCES.lightAccentColor &&
    preferences.lightBackgroundColor === DEFAULT_APPEARANCE_PREFERENCES.lightBackgroundColor &&
    preferences.lightForegroundColor === DEFAULT_APPEARANCE_PREFERENCES.lightForegroundColor &&
    preferences.lightUiFont === DEFAULT_APPEARANCE_PREFERENCES.lightUiFont &&
    preferences.lightCodeFont === DEFAULT_APPEARANCE_PREFERENCES.lightCodeFont &&
    preferences.lightContrast === DEFAULT_APPEARANCE_PREFERENCES.lightContrast &&
    preferences.darkAccentColor === DEFAULT_APPEARANCE_PREFERENCES.darkAccentColor &&
    preferences.darkBackgroundColor === DEFAULT_APPEARANCE_PREFERENCES.darkBackgroundColor &&
    preferences.darkForegroundColor === DEFAULT_APPEARANCE_PREFERENCES.darkForegroundColor &&
    preferences.darkUiFont === DEFAULT_APPEARANCE_PREFERENCES.darkUiFont &&
    preferences.darkCodeFont === DEFAULT_APPEARANCE_PREFERENCES.darkCodeFont &&
    preferences.darkContrast === DEFAULT_APPEARANCE_PREFERENCES.darkContrast &&
    preferences.usePointerCursor === DEFAULT_APPEARANCE_PREFERENCES.usePointerCursor &&
    preferences.reduceMotion === DEFAULT_APPEARANCE_PREFERENCES.reduceMotion &&
    preferences.uiFontSize === DEFAULT_APPEARANCE_PREFERENCES.uiFontSize &&
    preferences.codeFontSize === DEFAULT_APPEARANCE_PREFERENCES.codeFontSize &&
    preferences.showDiffMarkers === DEFAULT_APPEARANCE_PREFERENCES.showDiffMarkers
  );
}
