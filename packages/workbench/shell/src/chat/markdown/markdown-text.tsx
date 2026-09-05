"use client";

import { createCodePlugin } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { CheckIcon, CircleXIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import {
  Children,
  createContext,
  isValidElement,
  memo,
  useContext,
  useDeferredValue,
  useLayoutEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  CodeBlock,
  Streamdown,
  type Components,
  type LinkSafetyConfig,
  type LinkSafetyModalProps,
  type StreamdownProps,
} from "streamdown";

import { CODE_THEME_PAIRS, type CodeTheme, useAppearancePreferences } from "../../appearance";
import { InlineCitation, type Source } from "../../elements/inline-citation";
import { useDisclosureScrollLock } from "../../elements/use-disclosure-scroll-lock";
import { useClipboardCopy } from "../../hooks/use-clipboard-copy";
import { useI18n } from "../../i18n";
import { Button } from "../../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { cn } from "../../utils";
import { CodexCodeHeader } from "./codex-code-header";
import {
  INLINE_CITATION_GROUP_SENTINEL,
  parseInlineCitationUrlSentinel,
  preprocessInlineCitationMarkers,
} from "./inline-citation-markers";

interface InlineCitationContextValue {
  readonly sources: readonly Source[];
  readonly openIndex: number | null;
  readonly onOpenIndexChange: (index: number | null) => void;
}

const InlineCitationContext = createContext<InlineCitationContextValue | null>(null);
const mathPlugin = createMathPlugin({ singleDollarTextMath: true });
const LATEX_DISPLAY_MATH = /\\{1,2}\[([\s\S]+?)\\{1,2}\]/g;
const LATEX_INLINE_MATH = /\\{1,2}\(([^\n]+?)\\{1,2}\)/g;
const CUSTOM_DISPLAY_MATH = /\[\/math\]([\s\S]*?)\[\/math\]/g;
const CUSTOM_INLINE_MATH = /\[\/inline\]([\s\S]*?)\[\/inline\]/g;

export type MarkdownTextProps = Omit<
  StreamdownProps,
  | "animated"
  | "children"
  | "components"
  | "controls"
  | "isAnimating"
  | "lineNumbers"
  | "linkSafety"
  | "plugins"
  | "shikiTheme"
> & {
  readonly codeTheme?: CodeTheme;
  readonly defer?: boolean;
  readonly inheritLineHeight?: boolean;
  readonly isRunning?: boolean;
  readonly preserveWhitespace?: boolean;
  readonly preprocess?: (text: string) => string;
  readonly resetParagraphMargins?: boolean;
  readonly smooth?: boolean | Readonly<Record<string, number>>;
};

function normalizeMathDelimiters(text: string): string {
  return text
    .replace(CUSTOM_DISPLAY_MATH, (_, body: string) => `$$${body.trim()}$$`)
    .replace(CUSTOM_INLINE_MATH, (_, body: string) => `$${body.trim()}$`)
    .replace(LATEX_INLINE_MATH, (_, body: string) => `$${body.trim()}$`)
    .replace(LATEX_DISPLAY_MATH, (_, body: string) => `$$${body}$$`);
}

/** Keep prose prices out of single-dollar math while preserving likely numeric formulas. */
function escapeCurrencyDollars(text: string): string {
  return text.replace(/(^|[^\\$])\$(?=\d)/g, (_, prefix: string, offset: number) => {
    const dollar = offset + prefix.length;
    const close = text.indexOf("$", dollar + 1);
    const body = close < 0 ? "" : text.slice(dollar + 1, close);
    const likelyMath =
      close > dollar + 1 &&
      !/\s$/.test(body) &&
      (/[_^{}\\=+*/]/.test(body) || /^\d+(?:\.\d+)?$/.test(body));
    return `${prefix}${likelyMath ? "$" : "\\$"}`;
  });
}

function sourceFromCitationUrl(value: string): Source | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    const domain = url.hostname.replace(/^www\./i, "");
    return domain ? { domain, title: domain, snippet: url.href, url: url.href } : undefined;
  } catch {
    return undefined;
  }
}

function renderedText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      return isValidElement<{ children?: ReactNode }>(child)
        ? renderedText(child.props.children)
        : "";
    })
    .join("");
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

  const marker = parseInlineCitationUrlSentinel(text);
  if (citation && marker) {
    const contextualIndex = citation.sources.findIndex((source) => source.url === marker.url);
    const source =
      contextualIndex >= 0 ? citation.sources[contextualIndex] : sourceFromCitationUrl(marker.url);
    if (source) {
      return (
        <InlineCitation
          sources={[source]}
          openIndex={citation.openIndex === marker.occurrence ? 0 : null}
          onOpenIndexChange={(index) =>
            citation.onOpenIndexChange(index === null ? null : marker.occurrence)
          }
          indexOffset={contextualIndex >= 0 ? contextualIndex : marker.index}
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

function MarkdownCode({
  children,
  className,
  node: _node,
  "data-block": dataBlock,
  ...props
}: ComponentProps<"code"> & { node?: unknown; "data-block"?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [bodyRef, , prepareDisclosureTransition] = useDisclosureScrollLock(setExpanded);
  const code = dataBlock ? renderedText(children) : "";

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || expanded) return;

    const measure = () => {
      const viewport = body.querySelector<HTMLElement>('[data-streamdown="code-block-body"]');
      setOverflowing(Boolean(viewport && viewport.scrollHeight > viewport.clientHeight + 1));
    };
    const resizeObserver = new ResizeObserver(measure);
    const observeContent = () => {
      resizeObserver.disconnect();
      body.querySelectorAll('[data-streamdown="code-block-body"], pre').forEach((element) => {
        resizeObserver.observe(element);
      });
      measure();
    };
    // Highlighting can replace the scroll viewport after the initial render.
    const mutationObserver = new MutationObserver(observeContent);
    mutationObserver.observe(body, { childList: true, subtree: true, characterData: true });
    observeContent();
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [bodyRef, code, dataBlock, expanded]);

  if (!dataBlock) {
    return (
      <code className={cn("aui-streamdown-inline-code", className)} {...props}>
        {children}
      </code>
    );
  }
  const language = /language-([^\s]+)/.exec(className ?? "")?.[1] ?? "text";
  return (
    <>
      <CodexCodeHeader
        code={code}
        language={language}
        expanded={expanded}
        onToggleExpanded={
          expanded || overflowing
            ? () => {
                const duration = bodyRef.current
                  ? Number.parseFloat(
                      getComputedStyle(bodyRef.current).getPropertyValue(
                        "--layout-motion-duration",
                      ),
                    )
                  : 0;
                prepareDisclosureTransition(!expanded, duration || 0);
                setExpanded(!expanded);
              }
            : undefined
        }
      />
      <div ref={bodyRef} className="aui-codex-code-body" data-expanded={expanded}>
        <CodeBlock code={code} language={language} lineNumbers={false} />
      </div>
    </>
  );
}

const streamdownComponents = {
  code: MarkdownCode,
  sup: MarkdownSuperscript,
} as Components;

function MarkdownLinkSafetyDialog({ isOpen, onClose, onConfirm, url }: LinkSafetyModalProps) {
  const { t } = useI18n();
  const { copy, reset, status } = useClipboardCopy();
  const copyLabel = t(
    status === "copied"
      ? "assistant.linkSafety.copied"
      : status === "failed"
        ? "assistant.linkSafety.copyFailed"
        : "assistant.linkSafety.copy",
  );
  const close = () => {
    reset();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent closeLabel={t("assistant.common.close")} className="sm:max-w-md">
        <DialogHeader className="pe-8">
          <DialogTitle className="flex items-center gap-2">
            <ExternalLinkIcon aria-hidden="true" />
            {t("assistant.linkSafety.title")}
          </DialogTitle>
          <DialogDescription>{t("assistant.linkSafety.description")}</DialogDescription>
        </DialogHeader>
        <code className="max-h-32 overflow-auto rounded-lg bg-muted p-3 text-sm break-all">
          {url}
        </code>
        <DialogFooter closeLabel={t("assistant.common.close")} className="m-0">
          <Button type="button" variant="outline" aria-live="polite" onClick={() => void copy(url)}>
            {status === "copied" ? (
              <CheckIcon aria-hidden="true" data-icon="inline-start" />
            ) : status === "failed" ? (
              <CircleXIcon
                aria-hidden="true"
                className="text-destructive"
                data-icon="inline-start"
              />
            ) : (
              <CopyIcon aria-hidden="true" data-icon="inline-start" />
            )}
            {copyLabel}
          </Button>
          <Button
            type="button"
            onClick={() => {
              onConfirm();
              close();
            }}
          >
            <ExternalLinkIcon aria-hidden="true" data-icon="inline-start" />
            {t("assistant.linkSafety.open")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const streamdownLinkSafety = {
  enabled: true,
  renderModal: (props) => <MarkdownLinkSafetyDialog {...props} />,
} satisfies LinkSafetyConfig;

const ConfiguredMarkdownText = memo(function ConfiguredMarkdownText({
  className,
  codeTheme: codeThemeOverride,
  defer = false,
  inheritLineHeight = false,
  isRunning = false,
  mode = isRunning ? "streaming" : "static",
  preserveWhitespace = false,
  preprocess,
  resetParagraphMargins = false,
  smooth = false,
  text,
  ...props
}: MarkdownTextProps & Readonly<{ text: string }>) {
  const { codeTheme: preferredCodeTheme } = useAppearancePreferences();
  const { light, dark } = CODE_THEME_PAIRS[codeThemeOverride ?? preferredCodeTheme];
  const codePlugin = useMemo(() => createCodePlugin({ themes: [light, dark] }), [dark, light]);
  const plugins = useMemo(() => ({ code: codePlugin, math: mathPlugin }), [codePlugin]);
  const processed = useMemo(() => {
    const normalized = escapeCurrencyDollars(normalizeMathDelimiters(text));
    return preprocess?.(normalized) ?? normalized;
  }, [preprocess, text]);
  const deferredText = useDeferredValue(processed);

  return (
    <Streamdown
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
      isAnimating={isRunning}
      lineNumbers={false}
      linkSafety={streamdownLinkSafety}
      mode={mode}
      animated={Boolean(smooth && isRunning)}
      plugins={plugins}
    >
      {defer ? deferredText : processed}
    </Streamdown>
  );
});

export const MarkdownTextContent = memo(function MarkdownTextContent({
  text,
  ...props
}: MarkdownTextProps & Readonly<{ text: string }>) {
  return <ConfiguredMarkdownText text={text} {...props} />;
});

export const MarkdownTextContentWithCitations = memo(function MarkdownTextContentWithCitations({
  text,
  sources,
  isRunning = false,
}: Readonly<{ text: string; sources: readonly Source[]; isRunning?: boolean }>) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const context = useMemo(
    () => ({ sources, openIndex, onOpenIndexChange: setOpenIndex }),
    [openIndex, sources],
  );
  const preprocess = useMemo(
    () => (value: string) => {
      const result = preprocessInlineCitationMarkers(value);
      return result.markerCount === 0
        ? `${result.text}<sup>${INLINE_CITATION_GROUP_SENTINEL}</sup>`
        : result.text;
    },
    [],
  );

  return (
    <InlineCitationContext.Provider value={context}>
      <ConfiguredMarkdownText
        text={text}
        isRunning={isRunning}
        mode={isRunning ? "streaming" : "static"}
        preprocess={preprocess}
        smooth
      />
    </InlineCitationContext.Provider>
  );
});

export const MarkdownCodeBlockContent = memo(function MarkdownCodeBlockContent({
  className,
  code,
  codeTheme,
  language,
}: Readonly<{ className?: string; code: string; codeTheme?: CodeTheme; language: string }>) {
  const fenceLength = Math.max(3, ...(code.match(/`+/g) ?? []).map((run) => run.length + 1));
  const fence = "`".repeat(fenceLength);
  const info = language.trim().replace(/\s+/g, "-");
  const text = `${fence}${info}\n${code}${code.endsWith("\n") ? "" : "\n"}${fence}`;
  // Source code must bypass the prose math and currency normalization.
  return (
    <ConfiguredMarkdownText
      text={text}
      preprocess={() => text}
      className={className}
      codeTheme={codeTheme}
      mode="static"
    />
  );
});
