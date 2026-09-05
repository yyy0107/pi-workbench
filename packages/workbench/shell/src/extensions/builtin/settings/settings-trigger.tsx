"use client";

import { SettingsIcon } from "lucide-react";

import { Button } from "../../../ui";
import { useI18n } from "../../../i18n";
import { useCommandService } from "@workbench/extension-host";

export function SidebarSettingsTrigger() {
  const commands = useCommandService();
  const { t } = useI18n();
  const label = t("extensions.settings.open");

  return (
    <Button
      type="button"
      variant="ghost"
      size="default"
      aria-label={label}
      title={label}
      className="text-muted-foreground hover:text-foreground min-w-max flex-none justify-start gap-2"
      onClick={() => {
        void commands.execute("settings.open").catch((error) => {
          console.error(error);
        });
      }}
    >
      <SettingsIcon aria-hidden="true" />
      <span className="truncate">{t("extensions.settings.trigger")}</span>
    </Button>
  );
}
