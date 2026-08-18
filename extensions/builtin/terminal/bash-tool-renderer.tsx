"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { SquareTerminalIcon } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { TerminalBlock } from "@/components/elements/terminal-block";
import { useI18n } from "@/i18n";
import { usePanelService } from "@/platform/extensions";

interface BashToolArgs {
  command?: string;
}

export interface BashTerminalProps {
  command?: string;
  result: unknown;
  running: boolean;
}

function resultText(result: unknown): string | undefined {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return undefined;
  const text = (result as { text?: unknown }).text;
  if (typeof text === "string") return text;

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function resultLines(result: unknown): string[] {
  const output = resultText(result);
  if (!output) return [];
  return output.replace(/\r\n?/g, "\n").split("\n");
}

export function BashTerminal({ command, result, running }: BashTerminalProps) {
  const { t } = useI18n();
  const panels = usePanelService();
  const lines = resultLines(result);

  return (
    <TerminalBlock
      command={command || "bash"}
      lines={lines}
      visibleCount={lines.length}
      done={!running}
      headerAction={
        <TooltipIconButton
          data-slot="terminal-block-action"
          tooltip={t("extensions.terminal.tool.open")}
          className="text-foreground/40 hover:text-foreground"
          onClick={() => panels.open("terminal")}
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
      command={args.command}
      result={result ?? artifact}
      running={status.type !== "complete"}
    />
  );
};
