"use client";

import type { SyntaxHighlighterProps } from "@assistant-ui/react-markdown";

import { useWorkbenchHighlightedCode } from "@/components/code-highlighting";
import type { CodeTheme } from "@/extensions/builtin/appearance/appearance-preferences";

export interface CodeThemePreviewProps {
  code: string;
  language: string;
  label: string;
  codeTheme: CodeTheme;
}

export function SyntaxHighlighter({ code, language, components }: SyntaxHighlighterProps) {
  const highlightedCode = useWorkbenchHighlightedCode(code, language);
  const Pre = components.Pre;

  if (!highlightedCode) {
    return (
      <Pre>
        <code>{code}</code>
      </Pre>
    );
  }

  return (
    <div className="aui-shiki-base [&>pre]:border-border/50 [&>pre]:m-0 [&>pre]:overflow-x-auto [&>pre]:rounded-t-none [&>pre]:rounded-b-xl [&>pre]:border [&>pre]:border-t-0 [&>pre]:px-[10px]! [&>pre]:pt-0.5! [&>pre]:pb-3.5! [&>pre]:leading-relaxed [&>pre]:[font-size:var(--workbench-code-font-size,13px)]">
      {highlightedCode}
    </div>
  );
}

export function CodeThemePreview({ code, language, label, codeTheme }: CodeThemePreviewProps) {
  const highlightedCode = useWorkbenchHighlightedCode(code, language, codeTheme);

  return (
    <figure aria-label={label} className="bg-muted/30 overflow-hidden rounded-xl border">
      <figcaption className="text-muted-foreground flex items-center justify-between border-b px-3 py-1.5 text-xs">
        <span className="font-medium">{label}</span>
        <span className="font-mono lowercase">{language}</span>
      </figcaption>
      <div className="[&>pre]:m-0 [&>pre]:overflow-x-auto [&>pre]:p-3 [&>pre]:leading-relaxed [&>pre]:[font-size:var(--workbench-code-font-size,13px)]">
        {highlightedCode ?? (
          <pre>
            <code>{code}</code>
          </pre>
        )}
      </div>
    </figure>
  );
}
