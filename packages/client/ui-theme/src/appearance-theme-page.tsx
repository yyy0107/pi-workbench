"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workbench/ui";

import type { AppearancePageModel } from "./appearance-page-model";
import { SettingGroup, ColorModePicker } from "./appearance-setting-controls";
import { AppearanceFontPage } from "./appearance-font-page";
export function AppearanceThemePage(model: AppearancePageModel) {
  const { t, setThemeOverride, appearanceController, preferences, editingTheme, colorModeLabel } =
    model;
  return (
    <>
      <>
        <SettingGroup title={t("extensions.appearance.theme.mode")}>
          <ColorModePicker
            label={t("extensions.appearance.theme.mode")}
            value={preferences.colorMode}
            optionLabel={colorModeLabel}
            onChange={(colorMode) => {
              setThemeOverride(null);
              appearanceController.update({ colorMode });
            }}
          />
        </SettingGroup>

        <Tabs
          value={editingTheme}
          onValueChange={(value) => {
            if (value === "light" || value === "dark") setThemeOverride(value);
          }}
        >
          <TabsList aria-label={t("extensions.appearance.palette.title")}>
            <TabsTrigger value="light">{colorModeLabel("light")}</TabsTrigger>
            <TabsTrigger value="dark">{colorModeLabel("dark")}</TabsTrigger>
          </TabsList>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("extensions.appearance.palette.description")}
          </p>
          <TabsContent key={editingTheme} value={editingTheme}>
            <AppearanceFontPage {...model} />
          </TabsContent>
        </Tabs>
      </>
    </>
  );
}
