"use client";

import { SettingsIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useCommandService } from "@/platform/extensions";

function SettingsTrigger({ compact = false }: { compact?: boolean }) {
  const commands = useCommandService();
  const { t } = useI18n();
  const label = t("extensions.settings.open");

  return (
    <Button
      type="button"
      variant="ghost"
      size={compact ? "icon-sm" : "lg"}
      aria-label={label}
      aria-haspopup="dialog"
      title={label}
      className={cn(
        "text-muted-foreground hover:text-foreground",
        compact ? "md:hidden" : "min-w-0 flex-1 justify-start gap-2",
      )}
      onClick={() => {
        void commands.execute("settings.open").catch((error) => {
          console.error(error);
        });
      }}
    >
      <SettingsIcon className={compact ? "size-4" : "size-[18px]"} />
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
