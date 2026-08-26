"use client";

import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n";
import type { SettingsItemComponentProps } from "@/platform/extensions";

import { askUserPreferences, useAskUserEnabled } from "./ask-user-preferences";

export function AskUserSettingsItem({ sectionId, itemId }: SettingsItemComponentProps) {
  const { t } = useI18n();
  const enabled = useAskUserEnabled();
  const label = t("extensions.interactiveRequests.settings.enable");
  const descriptionId = `${sectionId}-${itemId}-description`;

  return (
    <div
      data-settings-section={sectionId}
      data-settings-item={itemId}
      className="flex min-h-20 flex-wrap items-center gap-4 py-4"
    >
      <div className="min-w-0 flex-1 basis-52">
        <label htmlFor={`${sectionId}-${itemId}`} className="text-sm font-medium">
          {label}
        </label>
        <p id={descriptionId} className="text-muted-foreground mt-1 text-sm leading-5">
          {t("extensions.interactiveRequests.settings.enableDescription")}
        </p>
      </div>
      <Switch
        id={`${sectionId}-${itemId}`}
        checked={enabled}
        aria-describedby={descriptionId}
        onCheckedChange={(checked) => askUserPreferences.setEnabled(checked)}
      />
    </div>
  );
}
