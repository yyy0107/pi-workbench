"use client";

import { TextMessagePartProvider } from "@assistant-ui/react";
import {
  StreamdownTextPrimitive,
  type StreamdownTextComponents,
  type StreamdownTextPrimitiveProps,
  type SyntaxHighlighterProps,
} from "@assistant-ui/react-streamdown";
import { createCodePlugin } from "@streamdown/code";
import {
  Children,
  createContext,
  isValidElement,
  memo,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { CodeBlock } from "streamdown";

import { CodexCodeHeader } from "@/components/assistant-ui/codex-code-header";
import { InlineCitation, type Source } from "@/components/elements/inline-citation";
import { cn } from "@/lib/utils";
import { CODE_THEME_PAIRS, type CodeTheme } from "@/services/appearance/appearance-preferences";
import { useAppearancePreferences } from "@/services/appearance/appearance-store";

import {
  INLINE_CITATION_GROUP_SENTINEL,
  parseInlineCitationUrlSentinel,
  preprocessInlineCitationMarkers,
} from "./inline-citation-markers";

interface InlineCitationContextValue {
  sources: readonly Source[];
  openIndex: number | null;
  onOpenIndexChange: (index: number | null) => void;
}

const InlineCitationContext = createContext<InlineCitationContextValue | null>(null);

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
  return <CitationMarkdownText sources={[]} appendUnplacedSources={false} />;
});

export const MarkdownTextWithCitations = memo(function MarkdownTextWithCitations({
  sources,
}: Readonly<{ sources: readonly Source[] }>) {
  return <CitationMarkdownText sources={sources} appendUnplacedSources />;
});

function CitationMarkdownText({
  sources,
  appendUnplacedSources,
}: Readonly<{ sources: readonly Source[]; appendUnplacedSources: boolean }>) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const context = useMemo(
    () => ({ sources, openIndex, onOpenIndexChange: setOpenIndex }),
    [openIndex, sources],
  );
  const preprocessCitations = useCallback(
    (text: string) => {
      const result = preprocessInlineCitationMarkers(text);
      return appendUnplacedSources && result.markerCount === 0
        ? `${result.text}<sup>${INLINE_CITATION_GROUP_SENTINEL}</sup>`
        : result.text;
    },
    [appendUnplacedSources],
  );

  return (
    <InlineCitationContext.Provider value={context}>
      <ConfiguredMarkdownText preprocess={preprocessCitations} />
    </InlineCitationContext.Provider>
  );
}

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

function MarkdownSuperscript({
  children,
  className,
  node: _node,
  ...props
}: ComponentProps<"sup"> & { node?: unknown }) {
  const citation = useContext(InlineCitationContext);
  const text = renderedText(children);

  if (citation && text === INLINE_CITATION_GROUP_SENTINEL) {
    return (
      <InlineCitation
        sources={[...citation.sources]}
        openIndex={citation.openIndex}
        onOpenIndexChange={citation.onOpenIndexChange}
      />
    );
  }

  const urlMarker = parseInlineCitationUrlSentinel(text);
  if (citation && urlMarker) {
    const contextualIndex = citation.sources.findIndex((source) => source.url === urlMarker.url);
    const referenceIndex = contextualIndex >= 0 ? contextualIndex : urlMarker.index;
    const openStateIndex = urlMarker.occurrence;
    const source =
      contextualIndex >= 0
        ? citation.sources[contextualIndex]
        : sourceFromCitationUrl(urlMarker.url);

    if (source) {
      return (
        <InlineCitation
          sources={[source]}
          openIndex={citation.openIndex === openStateIndex ? 0 : null}
          onOpenIndexChange={(index) =>
            citation.onOpenIndexChange(index === null ? null : openStateIndex)
          }
          indexOffset={referenceIndex}
        />
      );
    }
  }

  return (
    <sup data-streamdown="superscript" className={cn("text-sm", className)} {...props}>
      {children}
    </sup>
  );
}

function sourceFromCitationUrl(value: string): Source | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    const domain = url.hostname.replace(/^www\./i, "");
    if (!domain) return undefined;
    return { domain, title: domain, snippet: url.href, url: url.href };
  } catch {
    return undefined;
  }
}

function renderedText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (isValidElement<{ children?: ReactNode }>(child))
        return renderedText(child.props.children);
      return "";
    })
    .join("");
}

const streamdownComponents = {
  CodeHeader: CodexCodeHeader,
  SyntaxHighlighter: CodexSyntaxHighlighter,
  sup: MarkdownSuperscript,
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
