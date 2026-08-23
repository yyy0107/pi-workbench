"use client";

import { useId, useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";

import {
  languageForFilename,
  shouldHighlightWorkbenchCode,
  useWorkbenchHighlightedCode,
} from "@/components/code-highlighting";
import { cn } from "@/lib/utils";

export interface FileCodeLineDecoration {
  lineNumber: number;
  kind?: "added" | "removed";
}

function decorationStyles(
  rootSelector: string,
  decorations: readonly FileCodeLineDecoration[] | undefined,
): string {
  if (!decorations) return "";

  return decorations
    .map((decoration, index) => {
      const selector = `${rootSelector} [data-file-code] .line:nth-child(${index + 1})`;
      const lineNumber = `${selector}::before{content:"${decoration.lineNumber}"}`;
      if (decoration.kind === "added") {
        return `${lineNumber}${selector}::before{color:var(--file-diff-added)}${selector}::after{background:var(--file-diff-added-background)}`;
      }
      if (decoration.kind === "removed") {
        return `${lineNumber}${selector}::before{color:var(--file-diff-removed)}${selector}::after{background:var(--file-diff-removed-background)}`;
      }
      return lineNumber;
    })
    .join("");
}

export function FileCodeView({
  ariaLabel,
  name,
  value,
  decorations,
  children,
}: Readonly<{
  ariaLabel: string;
  name: string;
  value: string;
  decorations?: readonly FileCodeLineDecoration[];
  children?: ReactNode;
}>) {
  const reactId = useId();
  const viewId = `file-code-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const rootSelector = `[data-file-code-id="${viewId}"]`;
  const language = useMemo(() => languageForFilename(name), [name]);
  const shouldHighlight = useMemo(() => shouldHighlightWorkbenchCode(value), [value]);
  const useCompactPlainText = !shouldHighlight && !decorations;
  const highlighted = useWorkbenchHighlightedCode(value, language);
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
      data-file-code-view=""
      data-file-code-editor={children ? "" : undefined}
      data-file-code-id={viewId}
      role={children ? undefined : "region"}
      aria-label={children ? undefined : ariaLabel}
      className="relative min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-6 selection:bg-blue-500/20"
    >
      <style>{`
        ${rootSelector} {
          --file-diff-added: #16a34a;
          --file-diff-added-background: rgb(34 197 94 / 0.11);
          --file-diff-removed: #dc2626;
          --file-diff-removed-background: rgb(239 68 68 / 0.09);
        }
        .dark ${rootSelector} {
          --file-diff-added: #4ade80;
          --file-diff-added-background: rgb(34 197 94 / 0.12);
          --file-diff-removed: #f87171;
          --file-diff-removed-background: rgb(239 68 68 / 0.11);
        }
        ${rootSelector} [data-file-code] > pre:not([data-file-code-plain]) {
          margin: 0 !important;
          min-height: 100%;
          padding: 4px 12px 4px 60px !important;
          font-family: inherit !important;
          font-size: 0 !important;
          line-height: 0 !important;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          counter-reset: workspace-file-line;
        }
        ${rootSelector} [data-file-code] > pre:not([data-file-code-plain]) > code {
          display: block;
          min-width: 100%;
          font-size: 0 !important;
          line-height: 0 !important;
        }
        ${rootSelector} [data-file-code] > pre .line {
          position: relative;
          z-index: 0;
          isolation: isolate;
          display: block;
          min-height: 24px;
          margin: 0 !important;
          padding-block: 0 !important;
          border-block: 0 !important;
          font-size: 12px;
          line-height: 24px;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        ${rootSelector} [data-file-code] > pre .line::before {
          position: absolute;
          inset-inline-start: -60px;
          width: 48px;
          padding-inline-end: 12px;
          color: color-mix(in srgb, currentColor 42%, transparent);
          text-align: end;
          font-variant-numeric: tabular-nums;
          content: counter(workspace-file-line);
          counter-increment: workspace-file-line;
          user-select: none;
        }
        ${rootSelector} [data-file-code] > pre .line::after {
          position: absolute;
          z-index: -1;
          inset-block: 0;
          inset-inline-start: -60px;
          inset-inline-end: -12px;
          content: "";
        }
        ${rootSelector} [data-file-code] > pre[data-file-code-plain] {
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
        ${rootSelector} [data-file-code] > pre[data-file-code-plain] > code {
          font: inherit;
        }
        ${decorations ? `${rootSelector} [data-file-code] > pre { padding-block: 0 !important; }` : ""}
        ${lineStyles}
      `}</style>
      <div className="relative min-h-full min-w-0">
        <div
          data-file-code=""
          aria-hidden={children ? true : undefined}
          className={cn("min-h-full min-w-0", children && "pointer-events-none")}
        >
          {highlighted ??
            (useCompactPlainText ? (
              <pre data-file-code-plain="">
                <code>{value}</code>
              </pre>
            ) : (
              <ol
                className={cn(decorations ? "py-0" : "py-1", "text-slate-800 dark:text-slate-200")}
              >
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
            ))}
        </div>
        {children}
      </div>
    </div>
  );
}

export function FileCodeEditor({
  ariaLabel,
  name,
  saveLabel,
  value,
  onChange,
  onSave,
}: Readonly<{
  ariaLabel: string;
  name: string;
  saveLabel: string;
  value: string;
  onChange(value: string): void;
  onSave(): void | Promise<void>;
}>) {
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "s") {
      event.preventDefault();
      void onSave();
      return;
    }
    if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;

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
    <FileCodeView ariaLabel={ariaLabel} name={name} value={value}>
      <textarea
        ref={editorRef}
        value={value}
        wrap="soft"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label={ariaLabel}
        title={saveLabel}
        className="caret-foreground absolute inset-0 z-10 size-full resize-none overflow-hidden border-0 bg-transparent py-1 pe-3 ps-[60px] font-mono text-[12px] leading-6 whitespace-pre-wrap text-transparent outline-none selection:bg-blue-500/20"
        style={{ tabSize: 2 }}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
    </FileCodeView>
  );
}
