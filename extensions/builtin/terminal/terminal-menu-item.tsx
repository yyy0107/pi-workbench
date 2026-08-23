"use client";

import { TerminalIcon } from "lucide-react";

import { useRightWorkspace, useWorkspaceContext } from "@/components/right-workspace";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import type { WorkspaceSurfaceMenuItemProps } from "@/platform/extensions";

import { useTerminalLaunchContext } from "./terminal-target";
import { openTerminal } from "./terminal-workspace-service";

export function TerminalMenuItem({ closeMenu }: WorkspaceSurfaceMenuItemProps) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();
  const launch = useTerminalLaunchContext();

  return (
    <Button
      type="button"
      variant="ghost"
      className="h-9 w-full justify-start gap-3 rounded-xl px-2.5 font-normal"
      onClick={() => {
        openTerminal({
          controller,
          context,
          launch,
          title: t("extensions.terminal.title"),
        });
        closeMenu();
      }}
    >
      <TerminalIcon className="text-muted-foreground size-4" />
      <span className="min-w-0 flex-1 truncate text-start">{t("extensions.terminal.title")}</span>
      <kbd className="text-muted-foreground ms-auto text-xs">Ctrl+`</kbd>
    </Button>
  );
}
