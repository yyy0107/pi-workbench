"use client";

import { useId, useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";

import { MarkdownCodeBlockContent } from "../assistant-ui/lazy-markdown-text";
import { cn } from "../utils";

import { shouldHighlightWorkbenchCode } from "./code-highlight-policy";
import { languageForFilename } from "./shiki-catalog";

export interface WorkbenchCodeLineDecoration {
  lineNumber: number;
  kind?: "added" | "removed";
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
  const language = useMemo(() => languageForFilename(name), [name]);
  const shouldHighlight = useMemo(() => shouldHighlightWorkbenchCode(value), [value]);
  const useSyntaxHighlighting = shouldHighlight && !decorations;
  const useCompactPlainText = !useSyntaxHighlighting && !decorations;
  const lines = useMemo(() => (decorations ? value.split("\n") : []), [decorations, value]);

  return (
    <div
      data-workbench-code-view=""
      data-workbench-code-editor={children ? "" : undefined}
      role={children ? undefined : "region"}
      aria-label={children ? undefined : ariaLabel}
      aria-disabled={disabled || undefined}
      className={cn(
        "relative min-h-0 flex-1 overflow-auto font-mono leading-6 selection:bg-blue-500/20 [font-size:var(--workbench-code-font-size,13px)]",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <div className="relative min-h-full min-w-0">
        <div
          data-workbench-code=""
          aria-hidden={children ? true : undefined}
          className={cn("min-h-full min-w-0", children && "pointer-events-none")}
        >
          {useSyntaxHighlighting ? (
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
        className="caret-foreground absolute inset-0 z-10 size-full resize-none overflow-hidden border-0 bg-transparent py-1 pe-3 ps-[60px] font-mono leading-6 whitespace-pre-wrap text-transparent outline-none selection:bg-blue-500/20 disabled:cursor-not-allowed [font-size:var(--workbench-code-font-size,13px)] [tab-size:2]"
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
      <span id={helpId} className="sr-only">
        {exitLabel}
      </span>
    </WorkbenchCodeView>
  );
}
