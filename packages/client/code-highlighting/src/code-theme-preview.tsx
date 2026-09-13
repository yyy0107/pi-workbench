"use client";

import { WorkbenchCodeBlock } from "./workbench-code-block";
import type { CodeTheme } from "@workbench/appearance";

export interface CodeThemePreviewProps {
  code: string;
  language: string;
  label: string;
  codeTheme: CodeTheme;
}

export function CodeThemePreview({ code, language, label, codeTheme }: CodeThemePreviewProps) {
  return (
    <figure aria-label={label}>
      <WorkbenchCodeBlock
        className="aui-codex-code-preview"
        code={code}
        codeTheme={codeTheme}
        language={language}
      />
    </figure>
  );
}
