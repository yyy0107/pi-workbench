"use client";

import { CodeThemePreview } from "@workbench/code-highlighting";

import { SettingsGroup as SharedSettingsGroup } from "@workbench/ui";

import {
  CODE_FONT_FAMILIES,
  CODE_THEMES,
  CONTENT_FONT_FAMILIES,
  MAX_CODE_FONT_SIZE,
  MAX_THEME_CONTRAST,
  MAX_UI_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_THEME_CONTRAST,
  MIN_UI_FONT_SIZE,
  UI_FONT_FAMILIES,
} from "@workbench/appearance";

import { RangeControl, ColorControl } from "./appearance-controls";

const CODE_PREVIEW = [
  "const greet = (name: string) => {",
  "  const message = `Hello, ${name}!`;",
  "  return message;",
  "};",
].join("\n");

import type { AppearancePageModel } from "./appearance-page-model";
import {
  SettingRow,
  SelectControl,
  FontControl,
  AccentColorControl,
} from "./appearance-setting-controls";
export function AppearanceFontPage({
  t,
  systemFontStatus,
  systemFontOptions,
  appearanceController,
  preferences,
  editingTheme,
  uiFontLabel,
  contentFontLabel,
  codeFontLabel,
  codeThemeLabel,
  contrastLabel,
  fontSizeLabel,
}: Pick<
  AppearancePageModel,
  | "t"
  | "systemFonts"
  | "systemFontStatus"
  | "systemFontOptions"
  | "appearanceController"
  | "preferences"
  | "editingTheme"
  | "uiFontLabel"
  | "contentFontLabel"
  | "codeFontLabel"
  | "codeThemeLabel"
  | "contrastLabel"
  | "fontSizeLabel"
>) {
  return (
    <>
      <SharedSettingsGroup className="mt-4">
        <SettingRow label={t("extensions.appearance.themeSettings.accent")} wideControl>
          <AccentColorControl
            mode={editingTheme}
            color={preferences[`${editingTheme}AccentColor`]}
            onChange={(color) =>
              appearanceController.update({ [`${editingTheme}AccentColor`]: color })
            }
          />
        </SettingRow>
        <SettingRow label={t("extensions.appearance.themeSettings.background")}>
          <ColorControl
            color={preferences[`${editingTheme}BackgroundColor`]}
            label={t(`extensions.appearance.themeSettings.${editingTheme}Background`)}
            onChange={(color) =>
              appearanceController.update({ [`${editingTheme}BackgroundColor`]: color })
            }
          />
        </SettingRow>
        <SettingRow label={t("extensions.appearance.themeSettings.foreground")}>
          <ColorControl
            color={preferences[`${editingTheme}ForegroundColor`]}
            label={t(`extensions.appearance.themeSettings.${editingTheme}Foreground`)}
            onChange={(color) =>
              appearanceController.update({ [`${editingTheme}ForegroundColor`]: color })
            }
          />
        </SettingRow>
        <SettingRow
          label={t("extensions.appearance.typography.font")}
          description={
            systemFontStatus === "ready"
              ? undefined
              : t(`extensions.appearance.systemFonts.${systemFontStatus}`)
          }
          wideControl
        >
          <FontControl
            label={t("extensions.appearance.typography.font")}
            value={preferences.uiFont}
            options={[...UI_FONT_FAMILIES, ...systemFontOptions]}
            optionLabel={uiFontLabel}
            weight={preferences.uiFontWeight}
            onChange={(uiFont) => appearanceController.update({ uiFont })}
            onWeightChange={(uiFontWeight) => appearanceController.update({ uiFontWeight })}
          />
        </SettingRow>
        <SettingRow
          label={t("extensions.appearance.preferences.uiFontSize")}
          description={t("extensions.appearance.preferences.uiFontSizeDescription")}
        >
          <RangeControl
            label={t("extensions.appearance.preferences.uiFontSize")}
            value={preferences.uiFontSize}
            formatValue={fontSizeLabel}
            minimum={MIN_UI_FONT_SIZE}
            maximum={MAX_UI_FONT_SIZE}
            commitOnInteractionEnd
            onChange={(uiFontSize) => appearanceController.update({ uiFontSize })}
          />
        </SettingRow>
        <SettingRow
          label={t("extensions.appearance.typography.contentFont")}
          description={
            preferences.contentFont === "inherit"
              ? t("extensions.appearance.typography.inheritedWeightDescription")
              : undefined
          }
          wideControl
        >
          <FontControl
            label={t("extensions.appearance.typography.contentFont")}
            value={preferences.contentFont}
            options={[...CONTENT_FONT_FAMILIES, ...systemFontOptions]}
            optionLabel={contentFontLabel}
            weight={
              preferences.contentFont === "inherit"
                ? preferences.uiFontWeight
                : preferences.contentFontWeight
            }
            weightDisabled={preferences.contentFont === "inherit"}
            onChange={(contentFont) => appearanceController.update({ contentFont })}
            onWeightChange={(contentFontWeight) =>
              appearanceController.update({ contentFontWeight })
            }
          />
        </SettingRow>
        <SettingRow label={t("extensions.appearance.code.font")} wideControl>
          <FontControl
            label={t("extensions.appearance.code.font")}
            value={preferences.codeFont}
            options={[...CODE_FONT_FAMILIES, ...systemFontOptions]}
            optionLabel={codeFontLabel}
            weight={preferences.codeFontWeight}
            onChange={(codeFont) => appearanceController.update({ codeFont })}
            onWeightChange={(codeFontWeight) => appearanceController.update({ codeFontWeight })}
          />
        </SettingRow>
        <SettingRow
          label={t("extensions.appearance.preferences.codeFontSize")}
          description={t("extensions.appearance.preferences.codeFontSizeDescription")}
        >
          <RangeControl
            label={t("extensions.appearance.preferences.codeFontSize")}
            value={preferences.codeFontSize}
            formatValue={fontSizeLabel}
            minimum={MIN_CODE_FONT_SIZE}
            maximum={MAX_CODE_FONT_SIZE}
            onChange={(codeFontSize) => appearanceController.update({ codeFontSize })}
          />
        </SettingRow>
        <SettingRow
          label={t("extensions.appearance.preferences.codeTheme")}
          description={t("extensions.appearance.preferences.codeThemeDescription")}
        >
          <SelectControl
            label={t("extensions.appearance.preferences.codeTheme")}
            value={preferences.codeTheme}
            options={CODE_THEMES}
            optionLabel={codeThemeLabel}
            onChange={(codeTheme) => appearanceController.update({ codeTheme })}
          />
        </SettingRow>
        <div className="py-3">
          <CodeThemePreview
            code={CODE_PREVIEW}
            language="tsx"
            label={t("extensions.appearance.preferences.codePreview")}
            codeTheme={preferences.codeTheme}
          />
        </div>
        <SettingRow label={t("extensions.appearance.themeSettings.contrast")}>
          <RangeControl
            label={t(`extensions.appearance.themeSettings.${editingTheme}Contrast`)}
            value={preferences[`${editingTheme}Contrast`] - 100}
            formatValue={contrastLabel}
            minimum={MIN_THEME_CONTRAST - 100}
            maximum={MAX_THEME_CONTRAST - 100}
            onChange={(contrast) =>
              appearanceController.update({ [`${editingTheme}Contrast`]: contrast + 100 })
            }
          />
        </SettingRow>
      </SharedSettingsGroup>
    </>
  );
}
