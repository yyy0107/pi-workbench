"use client";

import { Switch } from "../../../ui/switch";
import { useI18n } from "../../../i18n";
import type { SettingsItemComponentProps } from "@workbench/extension-sdk";

import {
  useHardwareAccelerationController,
  useHardwareAccelerationPreferences,
} from "./hardware-acceleration-preferences";

export function HardwareAccelerationSettingsItem({
  sectionId,
  itemId,
}: SettingsItemComponentProps) {
  const { t } = useI18n();
  const controller = useHardwareAccelerationController();
  const preference = useHardwareAccelerationPreferences();
  const label = t("extensions.hardwareAcceleration.enable");
  const controlId = `${sectionId}-${itemId}`;
  const descriptionId = `${sectionId}-${itemId}-description`;
  const statusId = `${sectionId}-${itemId}-status`;
  const errorId = `${sectionId}-${itemId}-error`;
  const describedBy = [
    descriptionId,
    preference.restartRequired ? statusId : undefined,
    preference.saveFailed ? errorId : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      data-settings-section={sectionId}
      data-settings-item={itemId}
      className="flex min-h-20 flex-wrap items-center gap-4 py-4"
    >
      <div className="min-w-0 flex-1 basis-52">
        <label htmlFor={controlId} className="text-sm font-medium">
          {label}
        </label>
        <p id={descriptionId} className="text-muted-foreground mt-1 text-sm leading-5">
          {t("extensions.hardwareAcceleration.description")}
        </p>
        {preference.restartRequired ? (
          <p id={statusId} role="status" className="text-muted-foreground mt-1 text-sm leading-5">
            {t("extensions.hardwareAcceleration.restartRequired")}
          </p>
        ) : null}
        {preference.saveFailed ? (
          <p id={errorId} role="alert" className="mt-1 text-sm leading-5 text-destructive">
            {t("extensions.hardwareAcceleration.saveError")}
          </p>
        ) : null}
      </div>
      <Switch
        id={controlId}
        checked={preference.pendingEnabled ?? preference.enabled}
        disabled={preference.status !== "ready"}
        aria-busy={preference.status !== "ready"}
        aria-describedby={describedBy}
        aria-invalid={preference.saveFailed}
        onCheckedChange={(checked) => void controller.setEnabled(checked).catch(() => {})}
      />
    </div>
  );
}
