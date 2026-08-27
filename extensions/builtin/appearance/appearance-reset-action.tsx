"use client";

import { RotateCcwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import type { SettingsSectionHeaderActionComponentProps } from "@/platform/extensions";
import { appearanceStore, useAppearancePreferences } from "@/services/appearance/appearance-store";

import { backgroundImageStore, useBackgroundImage } from "./background-image-store";
import {
  DEFAULT_APPEARANCE_PREFERENCES_BY_PAGE,
  isDefaultAppearanceSettingsPage,
  resolveAppearanceSettingsPage,
} from "./appearance-settings-pages";

export function AppearanceResetAction({ sectionId }: SettingsSectionHeaderActionComponentProps) {
  const { t } = useI18n();
  const preferences = useAppearancePreferences();
  const backgroundImage = useBackgroundImage();
  const page = resolveAppearanceSettingsPage(sectionId);
  const isBackgroundImageDefault = backgroundImage.url === null && backgroundImage.error === null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={
        isDefaultAppearanceSettingsPage(preferences, page) &&
        (page !== "background" || isBackgroundImageDefault)
      }
      onClick={() => {
        appearanceStore.update(DEFAULT_APPEARANCE_PREFERENCES_BY_PAGE[page]);
        if (page === "background") void backgroundImageStore.clear();
      }}
    >
      <RotateCcwIcon />
      {t("extensions.appearance.reset")}
    </Button>
  );
}
