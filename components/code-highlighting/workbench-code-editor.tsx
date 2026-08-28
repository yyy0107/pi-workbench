"use client";

import { useId, useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";

import { MarkdownCodeBlockContent } from "@/components/assistant-ui/lazy-markdown-text";
import { cn } from "@/lib/utils";

import { shouldHighlightWorkbenchCode } from "./code-highlight-policy";
import { languageForFilename } from "./shiki-catalog";

export interface WorkbenchCodeLineDecoration {
  lineNumber: number;
  kind?: "added" | "removed";
}

function decorationStyles(
  rootSelector: string,
  decorations: readonly WorkbenchCodeLineDecoration[] | undefined,
): string {
  if (!decorations) return "";

  return decorations
    .map((decoration, index) => {
      const selector = `${rootSelector} [data-workbench-code] [data-streamdown="code-block-body"] code > span:nth-child(${index + 1})`;
      const lineNumber = `${selector}::before{content:"${decoration.lineNumber}"}`;
      if (decoration.kind === "added") {
        return `${lineNumber}${selector}::before{color:var(--workbench-code-added)}${selector}::after{background:var(--workbench-code-added-background)}`;
      }
      if (decoration.kind === "removed") {
        return `${lineNumber}${selector}::before{color:var(--workbench-code-removed)}${selector}::after{background:var(--workbench-code-removed-background)}`;
      }
      return lineNumber;
    })
    .join("");
}

export function WorkbenchCodeView({
  ariaLabel,
  name,
  value,
  decorations,
  className,
  disabled = false,
  children,
}: Readonly<{
  ariaLabel: string;
  name: string;
  value: string;
  decorations?: readonly WorkbenchCodeLineDecoration[];
  className?: string;
  disabled?: boolean;
  children?: ReactNode;
}>) {
  const reactId = useId();
  const viewId = `workbench-code-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const rootSelector = `[data-workbench-code-id="${viewId}"]`;
  const language = useMemo(() => languageForFilename(name), [name]);
  const shouldHighlight = useMemo(() => shouldHighlightWorkbenchCode(value), [value]);
  const useCompactPlainText = !shouldHighlight && !decorations;
  const lines = useMemo(
    () => (useCompactPlainText ? [] : value.split("\n")),
    [useCompactPlainText, value],
  );
  const lineStyles = useMemo(
    () => (shouldHighlight ? decorationStyles(rootSelector, decorations) : ""),
    [decorations, rootSelector, shouldHighlight],
  );

  return (
    <div
      data-workbench-code-view=""
      data-workbench-code-editor={children ? "" : undefined}
      data-workbench-code-id={viewId}
      role={children ? undefined : "region"}
      aria-label={children ? undefined : ariaLabel}
      aria-disabled={disabled || undefined}
      className={cn(
        "relative min-h-0 flex-1 overflow-auto font-mono leading-6 selection:bg-blue-500/20 [font-size:var(--workbench-code-font-size,13px)]",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <style>{`
        ${rootSelector} {
          --workbench-code-added: #16a34a;
          --workbench-code-added-background: rgb(34 197 94 / 0.11);
          --workbench-code-removed: #dc2626;
          --workbench-code-removed-background: rgb(239 68 68 / 0.09);
        }
        .dark ${rootSelector} {
          --workbench-code-added: #4ade80;
          --workbench-code-added-background: rgb(34 197 94 / 0.12);
          --workbench-code-removed: #f87171;
          --workbench-code-removed-background: rgb(239 68 68 / 0.11);
        }
        ${rootSelector} [data-workbench-code] .aui-workbench-code {
          min-height: 100%;
        }
        ${rootSelector} [data-workbench-code] .aui-workbench-code > .aui-codex-code-header {
          display: none;
        }
        ${rootSelector} [data-workbench-code] .aui-codex-code-body {
          min-height: 100%;
        }
        ${rootSelector} [data-workbench-code] .aui-codex-code-body > [data-streamdown="code-block"] {
          min-height: 100%;
          border: 0;
          border-radius: 0;
          background: transparent;
        }
        ${rootSelector} [data-workbench-code] [data-streamdown="code-block-body"] {
          min-height: 100%;
          overflow: visible;
          padding: 4px 12px 4px 60px;
          font-size: var(--workbench-code-font-size, 13px);
          line-height: 24px;
        }
        ${rootSelector} [data-workbench-code] [data-streamdown="code-block-body"] > pre {
          margin: 0 !important;
          min-height: 100%;
          font-family: inherit !important;
          font-size: inherit !important;
          line-height: inherit !important;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          counter-reset: workbench-code-line;
        }
        ${rootSelector} [data-workbench-code] [data-streamdown="code-block-body"] > pre > code {
          display: block;
          min-width: 100%;
        }
        ${rootSelector} [data-workbench-code] [data-streamdown="code-block-body"] > pre > code > span {
          position: relative;
          z-index: 0;
          isolation: isolate;
          display: block;
          min-height: 24px;
          margin: 0 !important;
          padding-block: 0 !important;
          border-block: 0 !important;
          font-size: var(--workbench-code-font-size, 13px);
          line-height: 24px;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        ${rootSelector} [data-workbench-code] [data-streamdown="code-block-body"] > pre > code > span::before {
          position: absolute;
          inset-inline-start: -60px;
          width: 48px;
          padding-inline-end: 12px;
          color: color-mix(in srgb, currentColor 42%, transparent);
          text-align: end;
          font-variant-numeric: tabular-nums;
          content: counter(workbench-code-line);
          counter-increment: workbench-code-line;
          user-select: none;
        }
        ${rootSelector} [data-workbench-code] [data-streamdown="code-block-body"] > pre > code > span::after {
          position: absolute;
          z-index: -1;
          inset-block: 0;
          inset-inline-start: -60px;
          inset-inline-end: -12px;
          content: "";
        }
        ${rootSelector} [data-workbench-code] > pre[data-workbench-code-plain] {
          box-sizing: border-box;
          min-width: 100%;
          min-height: 100%;
          margin: 0;
          padding: 4px 12px 4px 60px;
          color: var(--foreground);
          font: inherit;
          line-height: 24px;
          tab-size: 2;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        ${rootSelector} [data-workbench-code] > pre[data-workbench-code-plain] > code {
          font: inherit;
        }
        ${lineStyles}
      `}</style>
      <div className="relative min-h-full min-w-0">
        <div
          data-workbench-code=""
          aria-hidden={children ? true : undefined}
          className={cn("min-h-full min-w-0", children && "pointer-events-none")}
        >
          {shouldHighlight ? (
            <MarkdownCodeBlockContent
              className="aui-workbench-code"
              code={value}
              language={language}
            />
          ) : useCompactPlainText ? (
            <pre data-workbench-code-plain="">
              <code>{value}</code>
            </pre>
          ) : (
            <ol className={cn(decorations ? "py-0" : "py-1", "text-slate-800 dark:text-slate-200")}>
              {lines.map((line, index) => {
                const decoration = decorations?.[index];
                return (
                  <li
                    key={index}
                    className={cn(
                      "relative flex min-h-6 min-w-0",
                      decoration?.kind === "added" && "bg-emerald-500/10",
                      decoration?.kind === "removed" && "bg-red-500/10",
                    )}
                  >
                    <span
                      className={cn(
                        "text-muted-foreground/60 w-12 shrink-0 pe-3 text-end tabular-nums",
                        decoration?.kind === "added" && "text-emerald-600 dark:text-emerald-400",
                        decoration?.kind === "removed" && "text-red-600 dark:text-red-400",
                      )}
                    >
                      {decoration?.lineNumber ?? index + 1}
                    </span>
                    <code className="min-w-0 flex-1 whitespace-pre-wrap pe-3 ps-3 break-words">
                      {line || " "}
                    </code>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

export function WorkbenchCodeEditor({
  id,
  ariaLabel,
  exitLabel,
  name,
  saveLabel,
  value,
  disabled = false,
  className,
  onChange,
  onSave,
}: Readonly<{
  id?: string;
  ariaLabel: string;
  exitLabel: string;
  name: string;
  saveLabel: string;
  value: string;
  disabled?: boolean;
  className?: string;
  onChange(value: string): void;
  onSave(): void | Promise<void>;
}>) {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const helpId = useId();

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "s") {
      event.preventDefault();
      if (!disabled) void onSave();
      return;
    }
    if (disabled || event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;

    event.preventDefault();
    const editor = event.currentTarget;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const nextValue = `${value.slice(0, start)}  ${value.slice(end)}`;
    onChange(nextValue);
    requestAnimationFrame(() => {
      editorRef.current?.setSelectionRange(start + 2, start + 2);
    });
  };

  return (
    <WorkbenchCodeView
      ariaLabel={ariaLabel}
      name={name}
      value={value}
      disabled={disabled}
      className={className}
    >
      <textarea
        id={id}
        ref={editorRef}
        value={value}
        disabled={disabled}
        wrap="soft"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label={ariaLabel}
        aria-describedby={helpId}
        title={saveLabel}
        className="caret-foreground absolute inset-0 z-10 size-full resize-none overflow-hidden border-0 bg-transparent py-1 pe-3 ps-[60px] font-mono leading-6 whitespace-pre-wrap text-transparent outline-none selection:bg-blue-500/20 disabled:cursor-not-allowed [font-size:var(--workbench-code-font-size,13px)]"
        style={{ tabSize: 2 }}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
      <span id={helpId} className="sr-only">
        {exitLabel}
      </span>
    </WorkbenchCodeView>
  );
}
