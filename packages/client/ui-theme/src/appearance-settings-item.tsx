"use client";
import type { SettingsItemComponentProps } from "@workbench/extension-sdk";
import { resolveAppearanceSettingsPage } from "../lib/appearance-settings-pages";
import { useAppearancePageModel } from "./appearance-page-model";
import { AppearanceThemePage } from "./appearance-theme-page";
import { AppearanceInterfacePage } from "./appearance-interface-page";
import { AppearanceBackgroundPage } from "./appearance-background-page";

export function AppearanceSettingsItem({ sectionId, itemId }: SettingsItemComponentProps) {
  const model = useAppearancePageModel();
  const page = resolveAppearanceSettingsPage(sectionId);
  return (
    <div data-settings-section={sectionId} data-settings-item={itemId} className="py-4">
      <div className="divide-y">
        {page === "appearance" ? <AppearanceThemePage {...model} /> : null}
        {page === "interface" ? <AppearanceInterfacePage {...model} /> : null}
        {page === "background" ? <AppearanceBackgroundPage {...model} /> : null}
      </div>
    </div>
  );
}
