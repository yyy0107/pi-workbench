"use client";

import { MarkdownCodeBlockContent } from "./lazy-markdown-text";
import type { CodeTheme } from "../appearance";

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
