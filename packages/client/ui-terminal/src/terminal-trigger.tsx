"use client";

import { TerminalIcon } from "lucide-react";

import { useTerminalUiI18n as useI18n } from "./use-i18n";
import { useRightWorkspace, useWorkspaceContext } from "@workbench/workspace-runtime/react";
import { Button } from "@workbench/ui";

import { useTerminalLaunchContext } from "./terminal-target";
import { openTerminal, TERMINAL_SURFACE_TITLE } from "./terminal-workspace-service";

export function TerminalTrigger() {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();
  const launch = useTerminalLaunchContext();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="md:hidden"
      aria-label={t("extensions.terminal.newTerminal")}
      onClick={() => {
        openTerminal({
          controller,
          context,
          launch,
          title: TERMINAL_SURFACE_TITLE,
        });
      }}
    >
      <TerminalIcon className="size-4" />
    </Button>
  );
}
