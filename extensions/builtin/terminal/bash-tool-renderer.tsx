"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { KeyboardIcon, SquareTerminalIcon } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { useRightWorkspace, useWorkspaceContext } from "@/components/right-workspace";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { TerminalBlock } from "@/components/elements/terminal-block";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { usePiActiveSessionId } from "@/runtime/pi/client/runtime/context";
import type { WorkbenchBashInput } from "@/runtime/terminal/bash-tool-input";

import { normalizeTerminalTabTitle } from "./terminal-tab-title";
import { terminalResultLines } from "./terminal-tool-transcript";
import { revealTerminalTranscript, TERMINAL_SURFACE_TITLE } from "./terminal-workspace-service";

interface BashToolArgs {
  command?: string;
  input?: WorkbenchBashInput;
}

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
  const piSessionId = usePiActiveSessionId();
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

export const BashToolRenderer: ToolCallMessagePartComponent<BashToolArgs, unknown> = (props) => {
  const { args, result, artifact, status, isError } = props;
  const failed = isError || status.type === "incomplete";
  const requiresAction = status.type === "requires-action";

  if (failed || requiresAction) {
    return <ToolFallback {...props} />;
  }

  return (
    <BashTerminal
      toolCallId={props.toolCallId}
      command={args.command}
      result={result ?? artifact}
      running={status.type !== "complete"}
      input={args.input}
    />
  );
};
