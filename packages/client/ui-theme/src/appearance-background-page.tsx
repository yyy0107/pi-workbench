"use client";

import {
  BACKGROUND_BLURS,
  GLASS_BLURS,
  MAX_SURFACE_OPACITY,
  MIN_SURFACE_OPACITY,
} from "@workbench/appearance";

import { RangeControl, ColorControl, SwitchControl } from "./appearance-controls";

import type { AppearancePageModel } from "./appearance-page-model";
import {
  SettingGroup,
  SettingSubgroup,
  SettingRow,
  BackgroundImagePicker,
  SelectControl,
} from "./appearance-setting-controls";
export function AppearanceBackgroundPage({
  t,
  number,
  appearanceController,
  preferences,
  backgroundImage,
  backgroundBlurLabel,
  surfaceOpacityLabel,
  glassBlurLabel,
}: Pick<
  AppearancePageModel,
  | "t"
  | "number"
  | "appearanceController"
  | "preferences"
  | "backgroundImage"
  | "backgroundBlurLabel"
  | "surfaceOpacityLabel"
  | "glassBlurLabel"
>) {
  return (
    <>
      <SettingGroup
        title={t("extensions.appearance.background.title")}
        description={t("extensions.appearance.background.description")}
        layout="cards"
        showHeading={false}
      >
        <SettingSubgroup title={t("extensions.appearance.background.colorTitle")}>
          <SettingRow
            label={t("extensions.appearance.background.custom")}
            description={t("extensions.appearance.background.customDescription")}
          >
            <SwitchControl
              checked={preferences.customBackground}
              label={t("extensions.appearance.background.custom")}
              onChange={(customBackground) => appearanceController.update({ customBackground })}
            />
          </SettingRow>
          <SettingRow label={t("extensions.appearance.background.color")}>
            <ColorControl
              color={preferences.backgroundColor}
              disabled={!preferences.customBackground}
              label={t("extensions.appearance.background.color")}
              onChange={(backgroundColor) => appearanceController.update({ backgroundColor })}
            />
          </SettingRow>
          <SettingRow label={t("extensions.appearance.background.syncSurfaces")}>
            <SwitchControl
              checked={preferences.syncSurfaceColors}
              disabled={!preferences.customBackground}
              label={t("extensions.appearance.background.syncSurfaces")}
              onChange={(syncSurfaceColors) => appearanceController.update({ syncSurfaceColors })}
            />
          </SettingRow>
          <SettingRow
            label={t("extensions.appearance.background.surfaceColorBlend")}
            description={t("extensions.appearance.background.surfaceColorBlendDescription")}
          >
            <RangeControl
              label={t("extensions.appearance.background.surfaceColorBlend")}
              value={preferences.surfaceColorBlend}
              formatValue={(value) => number(value / 100, { style: "percent" })}
              minimum={0}
              maximum={100}
              disabled={!preferences.customBackground || !preferences.syncSurfaceColors}
              onChange={(surfaceColorBlend) => appearanceController.update({ surfaceColorBlend })}
            />
          </SettingRow>
        </SettingSubgroup>

        <SettingSubgroup title={t("extensions.appearance.background.imageTitle")}>
          <SettingRow label={t("extensions.appearance.background.image")}>
            <BackgroundImagePicker image={backgroundImage} />
          </SettingRow>
          <SettingRow
            label={t("extensions.appearance.background.blur")}
            description={
              !backgroundImage.url
                ? t("extensions.appearance.background.blurRequiresImage")
                : undefined
            }
          >
            <SelectControl
              label={t("extensions.appearance.background.blur")}
              value={preferences.backgroundBlur}
              options={BACKGROUND_BLURS}
              optionLabel={backgroundBlurLabel}
              disabled={!backgroundImage.url}
              onChange={(backgroundBlur) => appearanceController.update({ backgroundBlur })}
            />
          </SettingRow>
        </SettingSubgroup>

        <SettingSubgroup title={t("extensions.appearance.surfaces.title")}>
          <SettingRow
            label={t("extensions.appearance.surfaces.opacity")}
            description={t("extensions.appearance.surfaces.requiresBackground")}
          >
            <RangeControl
              label={t("extensions.appearance.surfaces.opacity")}
              value={preferences.surfaceOpacity}
              formatValue={surfaceOpacityLabel}
              minimum={MIN_SURFACE_OPACITY}
              maximum={MAX_SURFACE_OPACITY}
              disabled={!preferences.customBackground && !backgroundImage.url}
              onChange={(surfaceOpacity) => appearanceController.update({ surfaceOpacity })}
            />
          </SettingRow>
          <SettingRow label={t("extensions.appearance.surfaces.glassBlur")}>
            <SelectControl
              label={t("extensions.appearance.surfaces.glassBlur")}
              value={preferences.glassBlur}
              options={GLASS_BLURS}
              optionLabel={glassBlurLabel}
              disabled={!preferences.customBackground && !backgroundImage.url}
              onChange={(glassBlur) => appearanceController.update({ glassBlur })}
            />
          </SettingRow>
        </SettingSubgroup>
      </SettingGroup>
    </>
  );
}
