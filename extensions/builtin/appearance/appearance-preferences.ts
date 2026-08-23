import type { BundledTheme } from "shiki";

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

export const CODE_FONT_FAMILIES = [
  "geistMono",
  "systemMono",
  "compactMono",
  "jetBrainsMono",
  "firaCode",
  "cascadiaCode",
  "sourceCodePro",
  "ibmPlexMono",
  "menlo",
  "consolas",
  "liberationMono",
  "ubuntuMono",
] as const;
export type CodeFontFamily = (typeof CODE_FONT_FAMILIES)[number];

export const CODE_THEMES = [
  "dark-plus",
  "light-plus",
  "github-dark",
  "github-dark-dimmed",
  "github-dark-high-contrast",
  "github-light",
  "github-light-high-contrast",
  "one-dark-pro",
  "one-light",
  "dracula",
  "dracula-soft",
  "ayu-dark",
  "tokyo-night",
  "night-owl",
  "monokai",
  "min-dark",
  "min-light",
  "nord",
  "slack-dark",
  "slack-ochin",
  "vesper",
  "vitesse-dark",
  "vitesse-light",
  "catppuccin-mocha",
  "catppuccin-macchiato",
  "catppuccin-frappe",
  "catppuccin-latte",
  "kanagawa-wave",
  "kanagawa-dragon",
  "kanagawa-lotus",
  "everforest-dark",
  "everforest-light",
  "gruvbox-dark-medium",
  "gruvbox-light-medium",
  "material-theme",
  "material-theme-ocean",
  "material-theme-palenight",
  "rose-pine",
  "rose-pine-moon",
  "rose-pine-dawn",
  "solarized-dark",
  "solarized-light",
  "synthwave-84",
] as const;
export type CodeTheme = (typeof CODE_THEMES)[number];

export interface CodeThemePair {
  readonly light: BundledTheme;
  readonly dark: BundledTheme;
}

export const CODE_THEME_PAIRS = {
  "dark-plus": { light: "light-plus", dark: "dark-plus" },
  "light-plus": { light: "light-plus", dark: "dark-plus" },
  "github-dark": { light: "github-light", dark: "github-dark" },
  "github-dark-dimmed": { light: "github-light", dark: "github-dark-dimmed" },
  "github-dark-high-contrast": {
    light: "github-light-high-contrast",
    dark: "github-dark-high-contrast",
  },
  "github-light": { light: "github-light", dark: "github-dark" },
  "github-light-high-contrast": {
    light: "github-light-high-contrast",
    dark: "github-dark-high-contrast",
  },
  "one-dark-pro": { light: "one-light", dark: "one-dark-pro" },
  "one-light": { light: "one-light", dark: "one-dark-pro" },
  dracula: { light: "light-plus", dark: "dracula" },
  "dracula-soft": { light: "light-plus", dark: "dracula-soft" },
  "ayu-dark": { light: "light-plus", dark: "ayu-dark" },
  "tokyo-night": { light: "light-plus", dark: "tokyo-night" },
  "night-owl": { light: "light-plus", dark: "night-owl" },
  monokai: { light: "light-plus", dark: "monokai" },
  "min-dark": { light: "min-light", dark: "min-dark" },
  "min-light": { light: "min-light", dark: "min-dark" },
  nord: { light: "light-plus", dark: "nord" },
  "slack-dark": { light: "slack-ochin", dark: "slack-dark" },
  "slack-ochin": { light: "slack-ochin", dark: "slack-dark" },
  vesper: { light: "light-plus", dark: "vesper" },
  "vitesse-dark": { light: "vitesse-light", dark: "vitesse-dark" },
  "vitesse-light": { light: "vitesse-light", dark: "vitesse-dark" },
  "catppuccin-mocha": { light: "catppuccin-latte", dark: "catppuccin-mocha" },
  "catppuccin-macchiato": { light: "catppuccin-latte", dark: "catppuccin-macchiato" },
  "catppuccin-frappe": { light: "catppuccin-latte", dark: "catppuccin-frappe" },
  "catppuccin-latte": { light: "catppuccin-latte", dark: "catppuccin-mocha" },
  "kanagawa-wave": { light: "kanagawa-lotus", dark: "kanagawa-wave" },
  "kanagawa-dragon": { light: "kanagawa-lotus", dark: "kanagawa-dragon" },
  "kanagawa-lotus": { light: "kanagawa-lotus", dark: "kanagawa-wave" },
  "everforest-dark": { light: "everforest-light", dark: "everforest-dark" },
  "everforest-light": { light: "everforest-light", dark: "everforest-dark" },
  "gruvbox-dark-medium": { light: "gruvbox-light-medium", dark: "gruvbox-dark-medium" },
  "gruvbox-light-medium": { light: "gruvbox-light-medium", dark: "gruvbox-dark-medium" },
  "material-theme": { light: "material-theme-lighter", dark: "material-theme" },
  "material-theme-ocean": { light: "material-theme-lighter", dark: "material-theme-ocean" },
  "material-theme-palenight": {
    light: "material-theme-lighter",
    dark: "material-theme-palenight",
  },
  "rose-pine": { light: "rose-pine-dawn", dark: "rose-pine" },
  "rose-pine-moon": { light: "rose-pine-dawn", dark: "rose-pine-moon" },
  "rose-pine-dawn": { light: "rose-pine-dawn", dark: "rose-pine" },
  "solarized-dark": { light: "solarized-light", dark: "solarized-dark" },
  "solarized-light": { light: "solarized-light", dark: "solarized-dark" },
  "synthwave-84": { light: "light-plus", dark: "synthwave-84" },
} as const satisfies Record<CodeTheme, CodeThemePair>;

export type WorkbenchCodeTheme = (typeof CODE_THEME_PAIRS)[CodeTheme][keyof CodeThemePair];

const LEGACY_CODE_STYLE_THEMES: Readonly<Record<string, CodeTheme>> = {
  github: "dark-plus",
  vitesse: "vitesse-dark",
  catppuccin: "catppuccin-mocha",
  kanagawa: "kanagawa-wave",
};

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
  lightContrast: ThemeContrast;
  darkAccentColor: string;
  darkBackgroundColor: string;
  darkForegroundColor: string;
  darkContrast: ThemeContrast;
  uiFont: UiFontFamily;
  codeFont: CodeFontFamily;
  usePointerCursor: boolean;
  reduceMotion: boolean;
  uiFontSize: UiFontSize;
  codeFontSize: CodeFontSize;
  codeTheme: CodeTheme;
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
  lightContrast: 100,
  darkAccentColor: "#f4f4f5",
  darkBackgroundColor: "#18181b",
  darkForegroundColor: "#fafafa",
  darkContrast: 100,
  uiFont: "geist",
  codeFont: "geistMono",
  usePointerCursor: false,
  reduceMotion: false,
  uiFontSize: 16,
  codeFontSize: 13,
  codeTheme: "dark-plus",
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
    darkContrast: isIntegerInRange(value.darkContrast, MIN_THEME_CONTRAST, MAX_THEME_CONTRAST)
      ? value.darkContrast
      : DEFAULT_APPEARANCE_PREFERENCES.darkContrast,
    uiFont: isOneOf(value.uiFont, UI_FONT_FAMILIES)
      ? value.uiFont
      : isOneOf(value.lightUiFont, UI_FONT_FAMILIES)
        ? value.lightUiFont
        : isOneOf(value.darkUiFont, UI_FONT_FAMILIES)
          ? value.darkUiFont
          : DEFAULT_APPEARANCE_PREFERENCES.uiFont,
    codeFont: isOneOf(value.codeFont, CODE_FONT_FAMILIES)
      ? value.codeFont
      : isOneOf(value.lightCodeFont, CODE_FONT_FAMILIES)
        ? value.lightCodeFont
        : isOneOf(value.darkCodeFont, CODE_FONT_FAMILIES)
          ? value.darkCodeFont
          : DEFAULT_APPEARANCE_PREFERENCES.codeFont,
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
    codeTheme: isOneOf(value.codeTheme, CODE_THEMES)
      ? value.codeTheme
      : isOneOf(value.codeStyle, CODE_THEMES)
        ? value.codeStyle
        : typeof value.codeStyle === "string" && LEGACY_CODE_STYLE_THEMES[value.codeStyle]
          ? LEGACY_CODE_STYLE_THEMES[value.codeStyle]
          : DEFAULT_APPEARANCE_PREFERENCES.codeTheme,
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
    preferences.lightContrast === DEFAULT_APPEARANCE_PREFERENCES.lightContrast &&
    preferences.darkAccentColor === DEFAULT_APPEARANCE_PREFERENCES.darkAccentColor &&
    preferences.darkBackgroundColor === DEFAULT_APPEARANCE_PREFERENCES.darkBackgroundColor &&
    preferences.darkForegroundColor === DEFAULT_APPEARANCE_PREFERENCES.darkForegroundColor &&
    preferences.darkContrast === DEFAULT_APPEARANCE_PREFERENCES.darkContrast &&
    preferences.uiFont === DEFAULT_APPEARANCE_PREFERENCES.uiFont &&
    preferences.codeFont === DEFAULT_APPEARANCE_PREFERENCES.codeFont &&
    preferences.usePointerCursor === DEFAULT_APPEARANCE_PREFERENCES.usePointerCursor &&
    preferences.reduceMotion === DEFAULT_APPEARANCE_PREFERENCES.reduceMotion &&
    preferences.uiFontSize === DEFAULT_APPEARANCE_PREFERENCES.uiFontSize &&
    preferences.codeFontSize === DEFAULT_APPEARANCE_PREFERENCES.codeFontSize &&
    preferences.codeTheme === DEFAULT_APPEARANCE_PREFERENCES.codeTheme &&
    preferences.showDiffMarkers === DEFAULT_APPEARANCE_PREFERENCES.showDiffMarkers
  );
}
