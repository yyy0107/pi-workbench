"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { CircleAlertIcon, Loader2Icon, SquareTerminalIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { usePanelService } from "@/platform/extensions";

interface BashToolArgs {
  command?: string;
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

export const BashToolRenderer: ToolCallMessagePartComponent<BashToolArgs, unknown> = ({
  args,
  result,
  status,
  isError,
}) => {
  const { t } = useI18n();
  const panels = usePanelService();
  const failed = isError || status.type === "incomplete";
  const output = resultText(result);
  const statusLabel = failed
    ? t("extensions.terminal.tool.failed")
    : status.type === "running"
      ? t("extensions.terminal.tool.running")
      : status.type === "requires-action"
        ? t("extensions.terminal.tool.waiting")
        : t("extensions.terminal.tool.complete");

  return (
    <article className="overflow-hidden rounded-lg border bg-[#0d1117] text-[#d1d7e0]">
      <header className="flex min-w-0 items-center gap-2 border-b border-white/8 bg-[#11161d] px-3 py-2">
        {status.type === "running" ? (
          <Loader2Icon className="size-3.5 shrink-0 animate-spin text-[#58a6ff]" />
        ) : failed ? (
          <CircleAlertIcon className="size-3.5 shrink-0 text-[#f85149]" />
        ) : (
          <SquareTerminalIcon className="size-3.5 shrink-0 text-[#3fb950]" />
        )}
        <code className="min-w-0 flex-1 truncate text-xs text-[#f0f6fc]">
          {args.command || "bash"}
        </code>
        <span className="shrink-0 text-[10px] text-[#8b949e]">{statusLabel}</span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="h-6 shrink-0 px-2 text-[10px] text-[#b7c0cc] hover:bg-white/8 hover:text-white"
          onClick={() => panels.open("terminal")}
        >
          {t("extensions.terminal.tool.open")}
        </Button>
      </header>
      {output ? (
        <pre
          className="max-h-64 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-5 text-[#b7c0cc]"
          role={failed ? "alert" : undefined}
        >
          {output}
        </pre>
      ) : null}
    </article>
  );
};
