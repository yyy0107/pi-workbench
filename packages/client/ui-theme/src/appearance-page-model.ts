"use client";
import { themeTranslationBundle } from "./i18n";
import { useI18n } from "@workbench/i18n";

import { useMemo, useState } from "react";

import { useMediaQuery } from "@workbench/ui/hooks";

import { useRunningIndicatorCatalog } from "@workbench/shell-context/running-indicator";

import {
  CORNER_RADIUS_STYLES,
  type BackgroundBlur,
  type BorderStyle,
  type CodeFontFamily,
  type CodeTheme,
  type ColorMode,
  type ContentFontFamily,
  type CornerRadiusStyle,
  type GlassBlur,
  type RunningIndicatorId,
  type UiFontFamily,
  isLocalFontFamily,
} from "@workbench/appearance";
import {
  useAppearanceController,
  useAppearancePreferences,
  useSystemFonts,
} from "@workbench/appearance";

import { useBackgroundImage } from "./background-image-store";

export function useAppearancePageModel() {
  const { t, text, number, locale } = useI18n(themeTranslationBundle);
  const { fonts: systemFonts, status: systemFontStatus } = useSystemFonts();
  const systemFontOptions = useMemo(
    () => [...systemFonts].sort((a, b) => a.slice(6).localeCompare(b.slice(6), locale)),
    [systemFonts, locale],
  );
  const appearanceController = useAppearanceController();
  const preferences = useAppearancePreferences();
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const [themeOverride, setThemeOverride] = useState<"light" | "dark" | null>(null);
  const editingTheme =
    themeOverride ??
    (preferences.colorMode === "dark" || (preferences.colorMode === "system" && systemDark)
      ? "dark"
      : "light");
  const activityIndicators = useRunningIndicatorCatalog();
  const activityIndicatorStyleId = activityIndicators.resolve(
    preferences.runningIndicatorStyleId,
  ).id;
  const activityIndicatorStyleIds = activityIndicators.definitions.map(
    (definition) => definition.id,
  );
  const backgroundImage = useBackgroundImage();

  const colorModeLabel = (value: ColorMode): string =>
    t(`extensions.appearance.colorModes.${value}`);
  const backgroundBlurLabel = (value: BackgroundBlur): string =>
    t(`extensions.appearance.backgroundBlurs.${value}`);
  const surfaceOpacityLabel = (value: number): string =>
    t("extensions.appearance.surfaces.opacityValue", { opacity: value });
  const glassBlurLabel = (value: GlassBlur): string =>
    t(`extensions.appearance.backgroundBlurs.${value}`);
  const borderStyleLabel = (value: BorderStyle): string =>
    t(`extensions.appearance.borderStyles.${value}`);
  const cornerRadiusLabel = (value: CornerRadiusStyle): string =>
    t(`extensions.appearance.cornerRadiusStyles.${value}`);
  const cornerRadiusIndex = CORNER_RADIUS_STYLES.indexOf(preferences.cornerRadius);
  const cornerRadiusIndexLabel = (value: number): string =>
    cornerRadiusLabel(CORNER_RADIUS_STYLES[value] ?? preferences.cornerRadius);
  const uiFontLabel = (value: UiFontFamily): string =>
    isLocalFontFamily(value) ? value.slice(6) : t(`extensions.appearance.fontFamilies.ui.${value}`);
  const contentFontLabel = (value: ContentFontFamily): string =>
    value === "inherit" ? t("extensions.appearance.typography.inheritUiFont") : uiFontLabel(value);
  const runningIndicatorLabel = (value: RunningIndicatorId): string =>
    t(`extensions.appearance.runningIndicator.styles.${value}`);
  const activityIndicatorLabel = (value: string): string =>
    text(activityIndicators.resolve(value).label);
  const activityIndicatorSizeLabel = (value: number): string =>
    t("extensions.appearance.activityAnimation.sizeValue", { size: value });
  const codeFontLabel = (value: CodeFontFamily): string =>
    isLocalFontFamily(value)
      ? value.slice(6)
      : t(`extensions.appearance.fontFamilies.code.${value}`);
  const codeThemeLabel = (value: CodeTheme): string =>
    t(`extensions.appearance.codeThemes.${value}`);
  const contrastLabel = (value: number): string =>
    t("extensions.appearance.themeSettings.contrastValue", { contrast: value });
  const fontSizeLabel = (value: number): string =>
    t("extensions.appearance.preferences.fontSizeValue", { size: value });
  return {
    t,
    text,
    number,
    locale,
    systemFonts,
    systemFontStatus,
    themeOverride,
    setThemeOverride,
    systemFontOptions,
    appearanceController,
    preferences,
    systemDark,
    editingTheme,
    activityIndicators,
    activityIndicatorStyleId,
    activityIndicatorStyleIds,
    backgroundImage,
    colorModeLabel,
    backgroundBlurLabel,
    surfaceOpacityLabel,
    glassBlurLabel,
    borderStyleLabel,
    cornerRadiusLabel,
    cornerRadiusIndex,
    cornerRadiusIndexLabel,
    uiFontLabel,
    contentFontLabel,
    runningIndicatorLabel,
    activityIndicatorLabel,
    activityIndicatorSizeLabel,
    codeFontLabel,
    codeThemeLabel,
    contrastLabel,
    fontSizeLabel,
  };
}
export type AppearancePageModel = ReturnType<typeof useAppearancePageModel>;
