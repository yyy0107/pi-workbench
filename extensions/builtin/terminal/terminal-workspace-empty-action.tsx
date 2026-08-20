"use client";

import { TerminalIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { type WorkspaceEmptyActionsSlotContext, usePanelService } from "@/platform/extensions";

export function TerminalWorkspaceEmptyAction(_context: WorkspaceEmptyActionsSlotContext) {
  const { t } = useI18n();
  const panels = usePanelService();

  return (
    <Button
      type="button"
      role="menuitem"
      variant="ghost"
      className="h-9 w-full justify-start gap-3 rounded-xl px-2.5 font-normal"
      onClick={() => {
        panels.move("terminal", "bottom");
        panels.toggle("terminal");
      }}
    >
      <TerminalIcon className="text-muted-foreground size-4" />
      <span className="min-w-0 flex-1 truncate text-start">{t("extensions.terminal.title")}</span>
      <kbd className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">Ctrl+`</kbd>
    </Button>
  );
}
