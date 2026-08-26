"use client";

import { useId, useMemo, type ComponentProps, type ReactNode } from "react";
import { CheckIcon, CircleXIcon, CopyIcon } from "lucide-react";

import { languageForFilename, useWorkbenchHighlightedCode } from "@/components/code-highlighting";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { useClipboardCopy } from "@/hooks/use-clipboard-copy";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

import { mono } from "./surfaces";

export type DiffKind = "context" | "added" | "removed";

export interface DiffLine {
  kind: DiffKind;
  text: string;
}

function numberedLines(lines: readonly DiffLine[]): readonly number[] {
  let oldLine = 1;
  let newLine = 1;

  return lines.map((line) => {
    if (line.kind === "removed") return oldLine++;
    if (line.kind === "added") return newLine++;

    const lineNumber = newLine;
    oldLine += 1;
    newLine += 1;
    return lineNumber;
  });
}

function diffLineStyles(rootSelector: string, lines: readonly DiffLine[]): string {
  const numbers = numberedLines(lines);

  return lines
    .map((line, index) => {
      const selector = `${rootSelector} [data-diff-code] .line:nth-child(${index + 1})`;
      const number = numbers[index] ?? index + 1;
      if (line.kind === "added") {
        return `${selector}{background:var(--diff-added-background)}${selector}::before{content:"${number}";color:var(--diff-added)}${selector}::after{background:var(--diff-added)}`;
      }
      if (line.kind === "removed") {
        return `${selector}{background:var(--diff-removed-background)}${selector}::before{content:"${number}";color:var(--diff-removed)}${selector}::after{background:var(--diff-removed)}`;
      }
      return `${selector}::before{content:"${number}"}`;
    })
    .join("");
}

export function DiffHeader({
  filename,
  additions,
  deletions,
  children,
}: {
  filename: string;
  additions: number;
  deletions: number;
  children?: ReactNode;
}) {
  return (
    <div className="border-border/60 bg-muted/15 flex h-9 min-w-0 items-center border-b px-3">
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="text-muted-foreground min-w-0 truncate">{filename}</span>
        <span className={cn(mono, "shrink-0 tabular-nums")}>
          <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>{" "}
          <span className="text-red-600 dark:text-red-400">-{deletions}</span>
        </span>
      </div>
      {children}
    </div>
  );
}

export function CodeDiff({
  filename,
  additions,
  deletions,
  lines,
  cycle,
  className,
  ...props
}: Omit<
  ComponentProps<"div">,
  "children" | "filename" | "additions" | "deletions" | "lines" | "cycle"
> & {
  filename: string;
  additions: number;
  deletions: number;
  lines: readonly DiffLine[];
  cycle: number;
}) {
  const { t } = useI18n();
  const reactId = useId();
  const diffId = `code-diff-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const code = useMemo(() => lines.map((line) => line.text).join("\n"), [lines]);
  const language = useMemo(() => languageForFilename(filename), [filename]);
  const highlighted = useWorkbenchHighlightedCode(code, language);
  const rootSelector = `[data-code-diff-id="${diffId}"]`;
  const lineStyles = useMemo(() => diffLineStyles(rootSelector, lines), [lines, rootSelector]);
  const { copy, isCopied, status } = useClipboardCopy();
  const copyLabel = t(
    status === "copied"
      ? "assistant.actions.copied"
      : status === "failed"
        ? "assistant.actions.copyFailed"
        : "assistant.actions.copy",
  );

  return (
    <div
      data-slot="code-diff"
      data-code-diff-id={diffId}
      className={cn(
        "w-full max-w-md overflow-hidden rounded-xl border border-border/60 bg-background font-sans text-[13px] shadow-xs dark:shadow-none",
        className,
      )}
      {...props}
    >
      <style>{`
        ${rootSelector} {
          --diff-added: #16a34a;
          --diff-added-background: rgb(34 197 94 / 0.11);
          --diff-removed: #dc2626;
          --diff-removed-background: rgb(239 68 68 / 0.09);
        }
        .dark ${rootSelector} {
          --diff-added: #4ade80;
          --diff-added-background: rgb(34 197 94 / 0.12);
          --diff-removed: #f87171;
          --diff-removed-background: rgb(239 68 68 / 0.11);
        }
        ${rootSelector} [data-diff-code] > pre {
          width: max-content;
          min-width: 100%;
          margin: 0 !important;
          padding: 0 !important;
          overflow: visible !important;
          font-family: inherit !important;
          font-size: 13px !important;
          line-height: 28px !important;
          tab-size: 2;
        }
        ${rootSelector} [data-diff-code] > pre code {
          display: block;
          width: max-content;
          min-width: 100%;
          font-size: 0;
          line-height: 0;
        }
        ${rootSelector} [data-diff-code] .line {
          position: relative;
          display: block;
          min-height: 28px;
          padding-inline-start: 84px;
          padding-inline-end: 24px;
          font-size: 13px;
          line-height: 28px;
          white-space: pre;
        }
        ${rootSelector} [data-diff-code] .line::before {
          position: absolute;
          inset-block: 0;
          inset-inline-start: 0;
          width: 68px;
          padding-inline-end: 12px;
          border-inline-end: 1px solid var(--border);
          color: var(--muted-foreground);
          text-align: end;
          font-variant-numeric: tabular-nums;
          user-select: none;
        }
        ${rootSelector} [data-diff-code] .line::after {
          position: absolute;
          inset-block: 0;
          inset-inline-start: 0;
          width: 4px;
          content: "";
        }
        ${lineStyles}
      `}</style>

      <DiffHeader filename={filename} additions={additions} deletions={deletions}>
        <TooltipIconButton
          tooltip={copyLabel}
          aria-label={copyLabel}
          className="text-muted-foreground hover:text-foreground -me-1 size-7 shrink-0"
          disabled={!code}
          onClick={() => void copy(code)}
        >
          {isCopied ? (
            <CheckIcon className="size-4" />
          ) : status === "failed" ? (
            <CircleXIcon className="text-destructive size-4" />
          ) : (
            <CopyIcon className="size-4" />
          )}
        </TooltipIconButton>
      </DiffHeader>

      <div
        key={cycle}
        data-slot="code-diff-scroll"
        className="fade-in animate-in max-h-72 overflow-auto font-mono duration-200"
      >
        <div data-diff-code="" className="min-w-full">
          {highlighted ?? (
            <pre>
              <code>
                {lines.map((line, index) => (
                  <span key={`${cycle}-${index}-${line.text}`} className="line">
                    {line.text || " "}
                  </span>
                ))}
              </code>
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
