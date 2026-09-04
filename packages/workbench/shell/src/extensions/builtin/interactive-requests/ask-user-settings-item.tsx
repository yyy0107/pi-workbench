"use client";

import { useWorkbenchInteractionCapability } from "@workbench/agent-runtime-client/context";
import { RuntimeCapabilityUnavailable } from "../../runtime-capability-unavailable";

import { Switch } from "@workbench/shell/ui";
import { useI18n } from "@workbench/shell/i18n";
import type { SettingsItemComponentProps } from "@workbench/extension-sdk";

import { useAskUserPreferences, useAskUserPreferencesController } from "./ask-user-preferences";

function AvailableAskUserSettingsItem({ sectionId, itemId }: SettingsItemComponentProps) {
  const { t } = useI18n();
  const controller = useAskUserPreferencesController();
  const preference = useAskUserPreferences();
  const label = t("extensions.interactiveRequests.settings.enable");
  const controlId = `${sectionId}-${itemId}`;
  const descriptionId = `${sectionId}-${itemId}-description`;
  const errorId = `${sectionId}-${itemId}-error`;
  const describedBy = preference.saveFailed ? `${descriptionId} ${errorId}` : descriptionId;

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
          {t("extensions.interactiveRequests.settings.enableDescription")}
        </p>
        {preference.saveFailed ? (
          <p id={errorId} role="alert" className="mt-1 text-sm leading-5 text-destructive">
            {t("extensions.interactiveRequests.settings.saveError")}
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

export function AskUserSettingsItem(props: SettingsItemComponentProps) {
  return useWorkbenchInteractionCapability() ? (
    <AvailableAskUserSettingsItem {...props} />
  ) : (
    <RuntimeCapabilityUnavailable />
  );
}
