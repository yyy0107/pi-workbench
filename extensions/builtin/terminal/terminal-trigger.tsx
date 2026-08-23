"use client";

import { TerminalIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useRightWorkspace, useWorkspaceContext } from "@/components/right-workspace";
import { useI18n } from "@/i18n";

import { useTerminalLaunchContext } from "./terminal-target";
import { openTerminal } from "./terminal-workspace-service";

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
          title: t("extensions.terminal.title"),
        });
      }}
    >
      <TerminalIcon className="size-4" />
    </Button>
  );
}
