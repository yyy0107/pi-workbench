"use client";

import { TerminalIcon } from "lucide-react";

import { Button } from "@workbench/shell/ui";
import { useRightWorkspace, useWorkspaceContext } from "@workbench/shell/right-workspace/react";
import { usePiI18n } from "../../i18n";

import { useTerminalLaunchContext } from "./terminal-target";
import { openTerminal, TERMINAL_SURFACE_TITLE } from "./terminal-workspace-service";

export function TerminalTrigger() {
  const { t } = usePiI18n();
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
