"use client";

import { TextMessagePartProvider } from "@assistant-ui/react";
import {
  StreamdownTextPrimitive,
  type StreamdownTextComponents,
  type StreamdownTextPrimitiveProps,
  type SyntaxHighlighterProps,
} from "@assistant-ui/react-streamdown";
import { createCodePlugin } from "@streamdown/code";
import { memo, useMemo } from "react";
import { CodeBlock } from "streamdown";

import { CodexCodeHeader } from "@/components/assistant-ui/codex-code-header";
import { cn } from "@/lib/utils";
import { CODE_THEME_PAIRS, type CodeTheme } from "@/services/appearance/appearance-preferences";
import { useAppearancePreferences } from "@/services/appearance/appearance-store";

export type MarkdownTextProps = Omit<
  StreamdownTextPrimitiveProps,
  "components" | "controls" | "lineNumbers" | "plugins" | "shikiTheme"
> & {
  codeTheme?: CodeTheme;
  inheritLineHeight?: boolean;
  preserveWhitespace?: boolean;
  resetParagraphMargins?: boolean;
};

const MarkdownTextImpl = ({
  className,
  codeTheme: codeThemeOverride,
  defer = true,
  inheritLineHeight = false,
  mode = "streaming",
  preserveWhitespace = false,
  resetParagraphMargins = false,
  ...props
}: MarkdownTextProps) => {
  const { codeTheme: preferredCodeTheme } = useAppearancePreferences();
  const codeTheme = codeThemeOverride ?? preferredCodeTheme;
  const { light, dark } = CODE_THEME_PAIRS[codeTheme];
  const codePlugin = useMemo(
    () =>
      createCodePlugin({
        themes: [light, dark],
      }),
    [dark, light],
  );
  const plugins = useMemo(() => ({ code: codePlugin }), [codePlugin]);

  return (
    <StreamdownTextPrimitive
      {...props}
      className={cn(
        "aui-streamdown space-y-0 [&>*:first-child]:mt-0! [&>*:last-child]:mb-0!",
        inheritLineHeight &&
          "[&_p]:leading-[inherit]! [&_[data-streamdown=list-item]]:leading-[inherit]!",
        preserveWhitespace && "[&_p]:whitespace-pre-wrap!",
        resetParagraphMargins && "[&_p]:m-0!",
        className,
      )}
      components={streamdownComponents}
      controls={false}
      defer={defer}
      lineNumbers={false}
      mode={mode}
      plugins={plugins}
    />
  );
};

const ConfiguredMarkdownText = memo(MarkdownTextImpl);

export const MarkdownText = memo(function MarkdownText() {
  return <ConfiguredMarkdownText />;
});

export const CompactMarkdownText = memo(function CompactMarkdownText() {
  return <ConfiguredMarkdownText inheritLineHeight preserveWhitespace resetParagraphMargins />;
});

export const MarkdownTextContent = memo(function MarkdownTextContent({
  text,
  mode = "static",
  ...props
}: MarkdownTextProps & Readonly<{ text: string }>) {
  return (
    <TextMessagePartProvider text={text} isRunning={false}>
      <ConfiguredMarkdownText {...props} mode={mode} />
    </TextMessagePartProvider>
  );
});

export const MarkdownCodeBlockContent = memo(function MarkdownCodeBlockContent({
  className,
  code,
  codeTheme,
  language,
}: Readonly<{
  className?: string;
  code: string;
  codeTheme?: CodeTheme;
  language: string;
}>) {
  const text = useMemo(() => toFencedCodeBlock(code, language), [code, language]);

  return (
    <TextMessagePartProvider text={text} isRunning={false}>
      <ConfiguredMarkdownText
        className={className}
        codeTheme={codeTheme}
        defer={false}
        mode="static"
      />
    </TextMessagePartProvider>
  );
});

function CodexSyntaxHighlighter({ code, language }: SyntaxHighlighterProps) {
  return (
    <div className="aui-codex-code-body">
      <CodeBlock code={code} language={language || "text"} lineNumbers={false} />
    </div>
  );
}

const streamdownComponents = {
  CodeHeader: CodexCodeHeader,
  SyntaxHighlighter: CodexSyntaxHighlighter,
} as unknown as StreamdownTextComponents;

function toFencedCodeBlock(code: string, language: string): string {
  const longestBacktickRun = (code.match(/`+/g) ?? []).reduce(
    (longest, run) => Math.max(longest, run.length),
    0,
  );
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  const info = language.trim().replace(/\s+/g, "-");
  const trailingNewline = code.endsWith("\n") ? "" : "\n";

  return `${fence}${info}\n${code}${trailingNewline}${fence}`;
}
