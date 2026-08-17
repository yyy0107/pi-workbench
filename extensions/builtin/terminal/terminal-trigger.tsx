"use client";

import { TerminalIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { usePanelService } from "@/platform/extensions";

export function TerminalTrigger() {
  const { t } = useI18n();
  const panels = usePanelService();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="md:hidden"
      aria-label={t("extensions.terminal.toggleTitle")}
      onClick={() => panels.toggle("terminal")}
    >
      <TerminalIcon className="size-4" />
    </Button>
  );
}
