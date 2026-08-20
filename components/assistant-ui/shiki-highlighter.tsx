"use client";

import type { SyntaxHighlighterProps } from "@assistant-ui/react-markdown";
import { useShikiHighlighter, type Themes } from "react-shiki";

import { type CodeStyle } from "@/extensions/builtin/appearance/appearance-preferences";
import { useAppearancePreferences } from "@/extensions/builtin/appearance/appearance-store";

const THEMES = {
  github: { light: "github-light", dark: "github-dark" },
  vitesse: { light: "vitesse-light", dark: "vitesse-dark" },
  catppuccin: { light: "catppuccin-latte", dark: "catppuccin-mocha" },
  kanagawa: { light: "kanagawa-lotus", dark: "kanagawa-wave" },
} satisfies Record<CodeStyle, Themes>;

const HIGHLIGHT_OPTIONS = Object.freeze({
  defaultColor: "light-dark()",
  delay: 60,
});

export interface CodeStylePreviewProps {
  code: string;
  language: string;
  label: string;
  codeStyle: CodeStyle;
}

function normalizeLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (!normalized || normalized === "unknown" || normalized === "plain" || normalized === "text") {
    return "plaintext";
  }
  return normalized;
}

function useHighlightedCode(code: string, language: string, codeStyle: CodeStyle) {
  return useShikiHighlighter(
    code,
    normalizeLanguage(language),
    THEMES[codeStyle],
    HIGHLIGHT_OPTIONS,
  );
}

export function SyntaxHighlighter({ code, language, components }: SyntaxHighlighterProps) {
  const { codeStyle } = useAppearancePreferences();
  const highlightedCode = useHighlightedCode(code, language, codeStyle);
  const Pre = components.Pre;

  if (!highlightedCode) {
    return (
      <Pre>
        <code>{code}</code>
      </Pre>
    );
  }

  return (
    <div className="aui-shiki-base [&>pre]:border-border/50 [&>pre]:bg-muted/30! [&>pre]:m-0 [&>pre]:overflow-x-auto [&>pre]:rounded-t-none [&>pre]:rounded-b-xl [&>pre]:border [&>pre]:border-t-0 [&>pre]:px-[10px]! [&>pre]:pt-0.5! [&>pre]:pb-3.5! [&>pre]:leading-relaxed [&>pre]:[font-size:var(--workbench-code-font-size,13px)]">
      {highlightedCode}
    </div>
  );
}

export function CodeStylePreview({ code, language, label, codeStyle }: CodeStylePreviewProps) {
  const highlightedCode = useHighlightedCode(code, language, codeStyle);

  return (
    <figure aria-label={label} className="bg-muted/30 overflow-hidden rounded-xl border">
      <figcaption className="text-muted-foreground flex items-center justify-between border-b px-3 py-1.5 text-xs">
        <span className="font-medium">{label}</span>
        <span className="font-mono lowercase">{language}</span>
      </figcaption>
      <div className="[&>pre]:bg-transparent! [&>pre]:m-0 [&>pre]:overflow-x-auto [&>pre]:p-3 [&>pre]:leading-relaxed [&>pre]:[font-size:var(--workbench-code-font-size,13px)]">
        {highlightedCode ?? (
          <pre>
            <code>{code}</code>
          </pre>
        )}
      </div>
    </figure>
  );
}
