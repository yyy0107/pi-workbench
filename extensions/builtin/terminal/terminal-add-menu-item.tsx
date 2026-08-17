"use client";

import { TerminalIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { type RightPanelAddMenuSlotContext, usePanelService } from "@/platform/extensions";

export function TerminalAddMenuItem({ activePanelId, closeMenu }: RightPanelAddMenuSlotContext) {
  const { t } = useI18n();
  const panels = usePanelService();

  return (
    <Button
      type="button"
      role="menuitem"
      variant="ghost"
      aria-current={activePanelId === "terminal" ? "page" : undefined}
      className="h-9 w-full justify-start gap-3 rounded-xl px-2.5 font-normal"
      onClick={() => {
        panels.move("terminal", "right");
        panels.open("terminal");
        closeMenu();
      }}
    >
      <TerminalIcon className="text-muted-foreground size-4" />
      <span className="min-w-0 flex-1 truncate text-left">{t("extensions.terminal.title")}</span>
      <kbd className="text-muted-foreground ml-auto text-xs">Ctrl+`</kbd>
    </Button>
  );
}
