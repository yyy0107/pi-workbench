"use client";
import { terminalUiTranslationBundle } from "./i18n";
import { useI18n } from "@workbench/i18n";

import { TerminalIcon } from "lucide-react";

import { useRightWorkspace, useWorkspaceContext } from "@workbench/workspace-runtime/react";
import { Button } from "@workbench/ui";

import { useTerminalLaunchContext } from "./terminal-target";
import { openTerminal, TERMINAL_SURFACE_TITLE } from "./terminal-workspace-service";

export function TerminalTrigger() {
  const { t } = useI18n(terminalUiTranslationBundle);
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
