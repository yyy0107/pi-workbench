"use client";

import { TerminalIcon } from "lucide-react";

import type { WorkspaceSurfaceMenuItemProps } from "@workbench/extension-sdk";

import { useTerminalUiI18n as useI18n } from "./use-i18n";
import { useRightWorkspace, useWorkspaceContext } from "@workbench/workspace-runtime/react";
import { Button } from "@workbench/ui";

import { useTerminalLaunchContext } from "./terminal-target";
import { openTerminal, TERMINAL_SURFACE_TITLE } from "./terminal-workspace-service";

export function TerminalMenuItem({ closeMenu }: WorkspaceSurfaceMenuItemProps) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();
  const launch = useTerminalLaunchContext();

  return (
    <Button
      type="button"
      variant="ghost"
      className="w-full justify-start font-normal"
      onClick={() => {
        openTerminal({
          controller,
          context,
          launch,
          title: TERMINAL_SURFACE_TITLE,
        });
        closeMenu();
      }}
    >
      <TerminalIcon className="text-muted-foreground size-4" />
      <span className="min-w-0 flex-1 truncate text-start">{t("extensions.terminal.title")}</span>
    </Button>
  );
}
