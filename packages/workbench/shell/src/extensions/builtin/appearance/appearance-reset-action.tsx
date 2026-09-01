"use client";

import { RotateCcwIcon } from "lucide-react";

import { Button } from "../../../ui/button";
import { useI18n } from "../../../i18n";
import type { SettingsSectionHeaderActionComponentProps } from "@workbench/extension-sdk";
import { useAppearanceController, useAppearancePreferences } from "../../../appearance";

import { useBackgroundImage, useBackgroundImageController } from "./background-image-store";
import {
  DEFAULT_APPEARANCE_PREFERENCES_BY_PAGE,
  isDefaultAppearanceSettingsPage,
  resolveAppearanceSettingsPage,
} from "./appearance-settings-pages";

export function AppearanceResetAction({ sectionId }: SettingsSectionHeaderActionComponentProps) {
  const { t } = useI18n();
  const appearanceController = useAppearanceController();
  const preferences = useAppearancePreferences();
  const backgroundImageController = useBackgroundImageController();
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
        appearanceController.update(DEFAULT_APPEARANCE_PREFERENCES_BY_PAGE[page]);
        if (page === "background") void backgroundImageController.clear();
      }}
    >
      <RotateCcwIcon />
      {t("extensions.appearance.reset")}
    </Button>
  );
}
