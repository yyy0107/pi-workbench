"use client";

import { SettingsIcon } from "lucide-react";

import { Button } from "../../../ui";
import { useI18n } from "../../../i18n";
import { cn } from "../../../utils";
import { useCommandService } from "@workbench/extension-host";

function SettingsTrigger({ compact = false }: { compact?: boolean }) {
  const commands = useCommandService();
  const { t } = useI18n();
  const label = t("extensions.settings.open");

  return (
    <Button
      type="button"
      variant="ghost"
      size={compact ? "icon" : "lg"}
      aria-label={label}
      title={label}
      className={cn(
        "text-muted-foreground hover:text-foreground",
        compact ? "md:hidden" : "min-w-max flex-none justify-start gap-2",
      )}
      onClick={() => {
        void commands.execute("settings.open").catch((error) => {
          console.error(error);
        });
      }}
    >
      <SettingsIcon aria-hidden="true" />
      {!compact ? <span className="truncate">{t("extensions.settings.trigger")}</span> : null}
    </Button>
  );
}

export function SidebarSettingsTrigger() {
  return <SettingsTrigger />;
}

export function MobileSettingsTrigger() {
  return <SettingsTrigger compact />;
}
