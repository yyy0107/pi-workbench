"use client";

import { TerminalIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { type WorkspaceActionsSlotContext, usePanelService } from "@/platform/extensions";

export function TerminalWorkspaceAction(_context: WorkspaceActionsSlotContext) {
  const { t } = useI18n();
  const panels = usePanelService();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={t("extensions.terminal.toggleTitle")}
      title={t("extensions.terminal.toggleTitle")}
      onClick={() => {
        panels.move("terminal", "bottom");
        panels.toggle("terminal");
      }}
    >
      <TerminalIcon className="size-3.5" />
    </Button>
  );
}
