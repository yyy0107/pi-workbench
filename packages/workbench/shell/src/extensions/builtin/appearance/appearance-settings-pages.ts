import { DEFAULT_APPEARANCE_PREFERENCES, type AppearancePreferences } from "../../../appearance";

export const APPEARANCE_SETTINGS_PAGES = ["appearance", "interface", "background"] as const;

export type AppearanceSettingsPage = (typeof APPEARANCE_SETTINGS_PAGES)[number];

type DefaultPreferencesByPage = Record<
  AppearanceSettingsPage,
  Readonly<Partial<AppearancePreferences>>
>;

export const DEFAULT_APPEARANCE_PREFERENCES_BY_PAGE = {
  appearance: {
    colorMode: DEFAULT_APPEARANCE_PREFERENCES.colorMode,
    lightAccentColor: DEFAULT_APPEARANCE_PREFERENCES.lightAccentColor,
    lightBackgroundColor: DEFAULT_APPEARANCE_PREFERENCES.lightBackgroundColor,
    lightForegroundColor: DEFAULT_APPEARANCE_PREFERENCES.lightForegroundColor,
    lightContrast: DEFAULT_APPEARANCE_PREFERENCES.lightContrast,
    darkAccentColor: DEFAULT_APPEARANCE_PREFERENCES.darkAccentColor,
    darkBackgroundColor: DEFAULT_APPEARANCE_PREFERENCES.darkBackgroundColor,
    darkForegroundColor: DEFAULT_APPEARANCE_PREFERENCES.darkForegroundColor,
    darkContrast: DEFAULT_APPEARANCE_PREFERENCES.darkContrast,
    uiFont: DEFAULT_APPEARANCE_PREFERENCES.uiFont,
    uiFontWeight: DEFAULT_APPEARANCE_PREFERENCES.uiFontWeight,
    uiFontSize: DEFAULT_APPEARANCE_PREFERENCES.uiFontSize,
    contentFont: DEFAULT_APPEARANCE_PREFERENCES.contentFont,
    contentFontWeight: DEFAULT_APPEARANCE_PREFERENCES.contentFontWeight,
    codeFont: DEFAULT_APPEARANCE_PREFERENCES.codeFont,
    codeFontWeight: DEFAULT_APPEARANCE_PREFERENCES.codeFontWeight,
    codeFontSize: DEFAULT_APPEARANCE_PREFERENCES.codeFontSize,
    codeTheme: DEFAULT_APPEARANCE_PREFERENCES.codeTheme,
  },
  interface: {
    borderStyle: DEFAULT_APPEARANCE_PREFERENCES.borderStyle,
    customBorderColor: DEFAULT_APPEARANCE_PREFERENCES.customBorderColor,
    borderColor: DEFAULT_APPEARANCE_PREFERENCES.borderColor,
    cornerRadius: DEFAULT_APPEARANCE_PREFERENCES.cornerRadius,
    runningIndicatorId: DEFAULT_APPEARANCE_PREFERENCES.runningIndicatorId,
    runningIndicatorStyleId: DEFAULT_APPEARANCE_PREFERENCES.runningIndicatorStyleId,
    runningIndicatorSize: DEFAULT_APPEARANCE_PREFERENCES.runningIndicatorSize,
  },
  background: {
    customBackground: DEFAULT_APPEARANCE_PREFERENCES.customBackground,
    backgroundColor: DEFAULT_APPEARANCE_PREFERENCES.backgroundColor,
    backgroundBlur: DEFAULT_APPEARANCE_PREFERENCES.backgroundBlur,
    syncSurfaceColors: DEFAULT_APPEARANCE_PREFERENCES.syncSurfaceColors,
    surfaceColorBlend: DEFAULT_APPEARANCE_PREFERENCES.surfaceColorBlend,
    surfaceOpacity: DEFAULT_APPEARANCE_PREFERENCES.surfaceOpacity,
    glassBlur: DEFAULT_APPEARANCE_PREFERENCES.glassBlur,
  },
} as const satisfies DefaultPreferencesByPage;

export function resolveAppearanceSettingsPage(sectionId: string): AppearanceSettingsPage {
  return sectionId === "interface" || sectionId === "background" ? sectionId : "appearance";
}

export function isDefaultAppearanceSettingsPage(
  preferences: AppearancePreferences,
  page: AppearanceSettingsPage,
): boolean {
  const defaults = DEFAULT_APPEARANCE_PREFERENCES_BY_PAGE[page];
  return (Object.keys(defaults) as Array<keyof AppearancePreferences>).every(
    (key) => preferences[key] === defaults[key as keyof typeof defaults],
  );
}
