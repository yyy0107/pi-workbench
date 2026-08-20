"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { SquareTerminalIcon } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { useRightWorkspace, useWorkspaceContext } from "@/components/right-workspace";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { TerminalBlock } from "@/components/elements/terminal-block";
import { useI18n } from "@/i18n";
import { usePiActiveSessionId } from "@/runtime/pi/client/runtime/context";

import { normalizeTerminalTabTitle } from "./terminal-tab-title";
import { terminalResultLines } from "./terminal-tool-transcript";
import { revealTerminalTranscript } from "./terminal-workspace-service";

interface BashToolArgs {
  command?: string;
}

export interface BashTerminalProps {
  toolCallId: string;
  command?: string;
  result: unknown;
  running: boolean;
}

export function BashTerminal({ toolCallId, command, result, running }: BashTerminalProps) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();
  const piSessionId = usePiActiveSessionId();
  const displayedCommand = command || "bash";
  const lines = terminalResultLines(result);

  return (
    <TerminalBlock
      command={command || "bash"}
      lines={lines}
      visibleCount={lines.length}
      done={!running}
      headerAction={
        <TooltipIconButton
          data-slot="terminal-block-action"
          tooltip={t("extensions.terminal.tool.view")}
          className="text-foreground/40 hover:text-foreground"
          onClick={() =>
            revealTerminalTranscript({
              controller,
              context,
              toolCallId,
              command: displayedCommand,
              ...(piSessionId ? { piSessionId } : {}),
              title: normalizeTerminalTabTitle(displayedCommand) ?? t("extensions.terminal.title"),
            })
          }
        >
          <SquareTerminalIcon className="size-3.5" />
        </TooltipIconButton>
      }
      variant="paper"
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
    />
  );
};
