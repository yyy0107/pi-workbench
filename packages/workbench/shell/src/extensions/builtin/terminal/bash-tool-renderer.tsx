"use client";

import { KeyboardIcon, SquareTerminalIcon } from "lucide-react";

import type { ToolRendererComponent } from "@workbench/extension-sdk";
import { useWorkbenchAgentThreadId } from "@workbench/agent-runtime-client/context";
import { normalizeTerminalTabTitle } from "@workbench/terminal-client";
import { workbenchBashInputFromArgs, type WorkbenchBashInput } from "@workbench/terminal-contracts";

import { TerminalBlock } from "../../../elements";
import { useI18n } from "../../../i18n";
import { useRightWorkspace, useWorkspaceContext } from "../../../right-workspace-react";
import { Button, TooltipIconButton } from "../../../ui";

import { bashCommandFromArgs, terminalResultLines } from "./terminal-tool-transcript";
import { revealTerminalTranscript, TERMINAL_SURFACE_TITLE } from "./terminal-workspace-service";

export interface BashTerminalProps {
  toolCallId: string;
  command?: string;
  result: unknown;
  running: boolean;
  input?: WorkbenchBashInput;
}

export function BashTerminal({ toolCallId, command, result, running, input }: BashTerminalProps) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();
  const piSessionId = useWorkbenchAgentThreadId();
  const displayedCommand = command || "bash";
  const lines = terminalResultLines(result);
  const userInputRequested = running && input?.source === "user";
  const openTerminal = () =>
    revealTerminalTranscript({
      controller,
      context,
      toolCallId,
      command: displayedCommand,
      ...(piSessionId ? { piSessionId } : {}),
      title: normalizeTerminalTabTitle(displayedCommand) ?? TERMINAL_SURFACE_TITLE,
    });
  return (
    <TerminalBlock
      command={command || "bash"}
      lines={lines}
      visibleCount={lines.length}
      done={!running}
      title={t("extensions.terminal.tool.shellTitle")}
      titleAction={
        !userInputRequested ? (
          <TooltipIconButton
            data-slot="terminal-block-action"
            tooltip={t("extensions.terminal.tool.view")}
            className="size-6 text-muted-foreground/60 hover:text-foreground"
            onClick={openTerminal}
          >
            <SquareTerminalIcon className="size-3.5" />
          </TooltipIconButton>
        ) : (
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className="flex min-w-0 items-center gap-1 truncate text-xs text-amber-700 dark:text-amber-300"
              role="status"
            >
              <KeyboardIcon className="size-3.5 shrink-0" />
              <span className="truncate">{t("extensions.terminal.tool.userInputRequested")}</span>
            </span>
            <Button type="button" variant="outline" size="xs" onClick={openTerminal}>
              {t("extensions.terminal.tool.openTerminal")}
            </Button>
          </div>
        )
      }
      collapseCommandLabel={t("extensions.terminal.tool.collapseCommand")}
      expandCommandLabel={t("extensions.terminal.tool.expandCommand")}
      runningLabel={t("extensions.terminal.tool.statusRunning")}
      successLabel={t("extensions.terminal.tool.statusSuccess")}
      role="region"
      aria-label={t("extensions.terminal.output")}
    />
  );
}

export const BashToolRenderer: ToolRendererComponent = ({ block, fallback }) => {
  const failed = block.status === "error" || block.status === "incomplete";
  const requiresAction = block.status === "requires-action";

  if (failed || requiresAction) return fallback;

  return (
    <BashTerminal
      toolCallId={block.callId}
      command={bashCommandFromArgs(block.arguments)}
      result={block.result}
      running={block.status === "running"}
      input={workbenchBashInputFromArgs(block.arguments)}
    />
  );
};
