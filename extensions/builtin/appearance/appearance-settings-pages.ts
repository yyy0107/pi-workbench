import {
  DEFAULT_APPEARANCE_PREFERENCES,
  type AppearancePreferences,
} from "@/services/appearance/appearance-preferences";

export const APPEARANCE_SETTINGS_PAGES = ["appearance", "interface", "background", "code"] as const;

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
  },
  interface: {
    surfaceOpacity: DEFAULT_APPEARANCE_PREFERENCES.surfaceOpacity,
    glassBlur: DEFAULT_APPEARANCE_PREFERENCES.glassBlur,
    borderStyle: DEFAULT_APPEARANCE_PREFERENCES.borderStyle,
    customBorderColor: DEFAULT_APPEARANCE_PREFERENCES.customBorderColor,
    borderColor: DEFAULT_APPEARANCE_PREFERENCES.borderColor,
    cornerRadius: DEFAULT_APPEARANCE_PREFERENCES.cornerRadius,
    uiFont: DEFAULT_APPEARANCE_PREFERENCES.uiFont,
    uiFontSize: DEFAULT_APPEARANCE_PREFERENCES.uiFontSize,
    controlHeight: DEFAULT_APPEARANCE_PREFERENCES.controlHeight,
    switchControlHeight: DEFAULT_APPEARANCE_PREFERENCES.switchControlHeight,
    runningIndicatorId: DEFAULT_APPEARANCE_PREFERENCES.runningIndicatorId,
    piWorkingOrbState: DEFAULT_APPEARANCE_PREFERENCES.piWorkingOrbState,
    piWorkingOrbSize: DEFAULT_APPEARANCE_PREFERENCES.piWorkingOrbSize,
  },
  background: {
    customBackground: DEFAULT_APPEARANCE_PREFERENCES.customBackground,
    backgroundColor: DEFAULT_APPEARANCE_PREFERENCES.backgroundColor,
    backgroundBlur: DEFAULT_APPEARANCE_PREFERENCES.backgroundBlur,
    syncSurfaceColors: DEFAULT_APPEARANCE_PREFERENCES.syncSurfaceColors,
  },
  code: {
    codeFont: DEFAULT_APPEARANCE_PREFERENCES.codeFont,
    codeFontSize: DEFAULT_APPEARANCE_PREFERENCES.codeFontSize,
    codeTheme: DEFAULT_APPEARANCE_PREFERENCES.codeTheme,
    showDiffMarkers: DEFAULT_APPEARANCE_PREFERENCES.showDiffMarkers,
  },
} as const satisfies DefaultPreferencesByPage;

export function resolveAppearanceSettingsPage(sectionId: string): AppearanceSettingsPage {
  return sectionId === "interface" || sectionId === "background" || sectionId === "code"
    ? sectionId
    : "appearance";
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
