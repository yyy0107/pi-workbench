"use client";

import { RunningThreadIndicator } from "@workbench/ui/running-indicator";

import { RunningIndicator } from "@workbench/shell-context/running-indicator";

import {
  BORDER_STYLES,
  CORNER_RADIUS_STYLES,
  MAX_RUNNING_INDICATOR_SIZE,
  MIN_RUNNING_INDICATOR_SIZE,
  RUNNING_INDICATOR_IDS,
} from "@workbench/appearance";

import { RangeControl, ColorControl, SwitchControl } from "./appearance-controls";

import type { AppearancePageModel } from "./appearance-page-model";
import {
  SettingGroup,
  SettingSubgroup,
  SettingRow,
  SelectControl,
  AnimatedPreviewSelect,
} from "./appearance-setting-controls";
export function AppearanceInterfacePage({
  t,
  number,
  appearanceController,
  preferences,
  activityIndicators,
  activityIndicatorStyleId,
  activityIndicatorStyleIds,
  borderStyleLabel,
  cornerRadiusIndex,
  cornerRadiusIndexLabel,
  runningIndicatorLabel,
  activityIndicatorLabel,
  activityIndicatorSizeLabel,
}: Pick<
  AppearancePageModel,
  | "t"
  | "number"
  | "appearanceController"
  | "preferences"
  | "activityIndicators"
  | "activityIndicatorStyleId"
  | "activityIndicatorStyleIds"
  | "borderStyleLabel"
  | "cornerRadiusIndex"
  | "cornerRadiusIndexLabel"
  | "runningIndicatorLabel"
  | "activityIndicatorLabel"
  | "activityIndicatorSizeLabel"
>) {
  return (
    <>
      <>
        <SettingGroup
          title={t("extensions.appearance.runningIndicator.title")}
          description={t("extensions.appearance.runningIndicator.description")}
        >
          <SettingRow label={t("extensions.appearance.runningIndicator.style")}>
            <AnimatedPreviewSelect
              label={t("extensions.appearance.runningIndicator.style")}
              value={preferences.runningIndicatorId}
              options={RUNNING_INDICATOR_IDS}
              optionLabel={runningIndicatorLabel}
              renderPreview={(runningIndicatorId, animated) => (
                <RunningThreadIndicator id={runningIndicatorId} animated={animated} />
              )}
              onChange={(runningIndicatorId) => appearanceController.update({ runningIndicatorId })}
            />
          </SettingRow>
        </SettingGroup>

        <SettingGroup
          title={t("extensions.appearance.composerAnimation.title")}
          description={t("extensions.appearance.composerAnimation.description")}
        >
          <SettingRow label={t("extensions.appearance.composerAnimation.enabled")}>
            <SwitchControl
              checked={preferences.composerAnimationEnabled}
              label={t("extensions.appearance.composerAnimation.enabled")}
              onChange={(composerAnimationEnabled) =>
                appearanceController.update({ composerAnimationEnabled })
              }
            />
          </SettingRow>
          <SettingRow
            label={t("extensions.appearance.composerAnimation.intensity")}
            description={t("extensions.appearance.composerAnimation.intensityDescription")}
          >
            <RangeControl
              label={t("extensions.appearance.composerAnimation.intensity")}
              value={preferences.composerAnimationIntensity}
              formatValue={(value) => number(value / 100, { style: "percent" })}
              minimum={0}
              maximum={100}
              disabled={!preferences.composerAnimationEnabled}
              onChange={(composerAnimationIntensity) =>
                appearanceController.update({ composerAnimationIntensity })
              }
            />
          </SettingRow>
        </SettingGroup>

        <SettingGroup
          title={t("extensions.appearance.activityAnimation.title")}
          description={t("extensions.appearance.activityAnimation.description")}
        >
          <SettingRow label={t("extensions.appearance.activityAnimation.style")}>
            <AnimatedPreviewSelect
              label={t("extensions.appearance.activityAnimation.style")}
              value={activityIndicatorStyleId}
              options={activityIndicatorStyleIds}
              optionLabel={activityIndicatorLabel}
              renderPreview={(styleId, animated) => (
                <RunningIndicator styleId={styleId} paused={!animated} className="size-full" />
              )}
              previewAspectRatio={(styleId) =>
                activityIndicators.resolve(styleId).presentation?.aspectRatio
              }
              previewOnly={(styleId) =>
                activityIndicators.resolve(styleId).presentation?.previewOnly ?? false
              }
              previewClassName={(styleId) =>
                activityIndicators.resolve(styleId).presentation?.previewClassName
              }
              onChange={(runningIndicatorStyleId) =>
                appearanceController.update({ runningIndicatorStyleId })
              }
            />
          </SettingRow>
          <SettingRow
            label={t("extensions.appearance.activityAnimation.size")}
            description={t("extensions.appearance.activityAnimation.sizeDescription")}
          >
            <RangeControl
              label={t("extensions.appearance.activityAnimation.size")}
              value={preferences.runningIndicatorSize}
              formatValue={activityIndicatorSizeLabel}
              renderPreview={(size) => (
                <span
                  className="flex shrink-0 items-center justify-center"
                  style={{ width: size, height: size }}
                >
                  <RunningIndicator styleId={activityIndicatorStyleId} />
                </span>
              )}
              minimum={MIN_RUNNING_INDICATOR_SIZE}
              maximum={MAX_RUNNING_INDICATOR_SIZE}
              onChange={(runningIndicatorSize) =>
                appearanceController.update({ runningIndicatorSize })
              }
            />
          </SettingRow>
        </SettingGroup>

        <SettingGroup layout="cards" showHeading={false}>
          <SettingSubgroup title={t("extensions.appearance.borders.title")}>
            <SettingRow label={t("extensions.appearance.borders.style")}>
              <SelectControl
                label={t("extensions.appearance.borders.style")}
                value={preferences.borderStyle}
                options={BORDER_STYLES}
                optionLabel={borderStyleLabel}
                onChange={(borderStyle) => appearanceController.update({ borderStyle })}
              />
            </SettingRow>
            <SettingRow label={t("extensions.appearance.borders.customColor")}>
              <SwitchControl
                checked={preferences.customBorderColor}
                label={t("extensions.appearance.borders.customColor")}
                onChange={(customBorderColor) => appearanceController.update({ customBorderColor })}
              />
            </SettingRow>
            <SettingRow
              label={t("extensions.appearance.borders.color")}
              description={
                !preferences.customBorderColor
                  ? t("extensions.appearance.borders.colorRequiresCustom")
                  : undefined
              }
            >
              <ColorControl
                color={preferences.borderColor}
                disabled={!preferences.customBorderColor}
                label={t("extensions.appearance.borders.color")}
                onChange={(borderColor) => appearanceController.update({ borderColor })}
              />
            </SettingRow>
          </SettingSubgroup>

          <SettingSubgroup title={t("extensions.appearance.corners.title")}>
            <SettingRow label={t("extensions.appearance.corners.radius")}>
              <RangeControl
                label={t("extensions.appearance.corners.radius")}
                value={cornerRadiusIndex}
                formatValue={cornerRadiusIndexLabel}
                minimum={0}
                maximum={CORNER_RADIUS_STYLES.length - 1}
                onChange={(index) => {
                  const cornerRadius = CORNER_RADIUS_STYLES[index];
                  if (cornerRadius) appearanceController.update({ cornerRadius });
                }}
              />
            </SettingRow>
          </SettingSubgroup>
        </SettingGroup>
      </>
    </>
  );
}
