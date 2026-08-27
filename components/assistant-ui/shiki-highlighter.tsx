"use client";

import { MarkdownCodeBlockContent } from "@/components/assistant-ui/markdown-text";
import type { CodeTheme } from "@/services/appearance/appearance-preferences";

export interface CodeThemePreviewProps {
  code: string;
  language: string;
  label: string;
  codeTheme: CodeTheme;
}

export function CodeThemePreview({ code, language, label, codeTheme }: CodeThemePreviewProps) {
  return (
    <figure aria-label={label}>
      <MarkdownCodeBlockContent
        className="aui-codex-code-preview"
        code={code}
        codeTheme={codeTheme}
        language={language}
      />
    </figure>
  );
}
