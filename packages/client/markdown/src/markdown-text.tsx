"use client";
import { markdownTranslationBundle } from "./i18n";
import { useI18n } from "@workbench/i18n";

import "katex/dist/katex.min.css";
import { normalizeMarkdownText } from "../lib/markdown-normalize";
import { CheckIcon, CircleXIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import {
  Children,
  createContext,
  isValidElement,
  memo,
  useContext,
  useDeferredValue,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { WorkbenchMarkdown, type MarkdownComponents } from "./workbench-markdown";
import { WorkbenchCodeBlockBody } from "@workbench/code-highlighting";

import { type CodeTheme } from "@workbench/appearance";
import { InlineCitation, type Source } from "./inline-citation";
import { useClipboardCopy } from "@workbench/ui/hooks";

import { Button } from "@workbench/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workbench/ui";
import { cn } from "@workbench/ui/utils";
import { MermaidCode } from "./mermaid-code";
import { MarkdownFileLink, MarkdownLinkIcon } from "./markdown-link-icons";
import {
  INLINE_CITATION_GROUP_SENTINEL,
  parseInlineCitationUrlSentinel,
  preprocessInlineCitationMarkers,
} from "../lib/inline-citation-markers";

interface InlineCitationContextValue {
  readonly sources: readonly Source[];
  readonly openIndex: number | null;
  readonly onOpenIndexChange: (index: number | null) => void;
}

const InlineCitationContext = createContext<InlineCitationContextValue | null>(null);
const CodeThemeContext = createContext<CodeTheme | undefined>(undefined);
export type MarkdownTextProps = Omit<ComponentProps<"div">, "children"> & {
  readonly mode?: "streaming" | "static";
  readonly decorateLinks?: boolean;
  readonly codeTheme?: CodeTheme;
  readonly defer?: boolean;
  readonly inheritLineHeight?: boolean;
  readonly isRunning?: boolean;
  readonly preserveWhitespace?: boolean;
  readonly preprocess?: (text: string) => string;
  readonly resetParagraphMargins?: boolean;
  readonly smooth?: boolean;
};

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
    <sup data-markdown="superscript" className={cn("text-sm", className)} {...props}>
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
  const codeTheme = useContext(CodeThemeContext);
  if (!dataBlock)
    return (
      <code className={cn("aui-markdown-inline-code", className)} {...props}>
        {children}
      </code>
    );
  const language = /language-([^\s]+)/.exec(className ?? "")?.[1] ?? "text";
  return (
    <WorkbenchCodeBlockBody
      code={renderedText(children)}
      language={language}
      codeTheme={codeTheme}
    />
  );
}

const sourceCodeComponents = {
  a: MarkdownLink,
  pre: ({ children }: { children?: ReactNode }) => <>{children}</>,
  table: ({ children, node: _node, ...props }: ComponentProps<"table"> & { node?: unknown }) => (
    <div data-markdown="table-wrapper">
      <table {...props}>{children}</table>
    </div>
  ),
  code: MarkdownCode,
  span: MarkdownLinkIcon,
  "workbench-file-link": MarkdownFileLink,
  sup: MarkdownSuperscript,
} as MarkdownComponents;

const markdownComponents = {
  ...sourceCodeComponents,
  code: (props: ComponentProps<typeof MarkdownCode>) =>
    props["data-block"] && /(?:^|\s)language-mermaid(?:\s|$)/i.test(props.className ?? "") ? (
      <MermaidCode code={renderedText(props.children)} />
    ) : (
      <MarkdownCode {...props} />
    ),
} as MarkdownComponents;

interface LinkSafetyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  url: string;
}

function MarkdownLink({
  href,
  children,
  node: _node,
  ...props
}: ComponentProps<"a"> & { node?: unknown }) {
  const [open, setOpen] = useState(false);
  if (!href) return <span>{children}</span>;
  if (href.startsWith("#"))
    return (
      <a {...props} href={href} data-markdown="link">
        {children}
      </a>
    );
  return (
    <>
      <button type="button" data-markdown="link" onClick={() => setOpen(true)}>
        {children}
      </button>
      {open ? (
        <MarkdownLinkSafetyDialog
          isOpen
          onClose={() => setOpen(false)}
          onConfirm={() => window.open(href, "_blank", "noopener,noreferrer")}
          url={href}
        />
      ) : null}
    </>
  );
}

function MarkdownLinkSafetyDialog({ isOpen, onClose, onConfirm, url }: LinkSafetyModalProps) {
  const { t } = useI18n(markdownTranslationBundle);
  const { copy, reset, status } = useClipboardCopy();
  const copyLabel = t(
    status === "copied"
      ? "markdown.linkSafety.copied"
      : status === "failed"
        ? "markdown.linkSafety.copyFailed"
        : "markdown.linkSafety.copy",
  );
  const close = () => {
    reset();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent closeLabel={t("markdown.close")} className="sm:max-w-md">
        <DialogHeader className="pe-8">
          <DialogTitle className="flex items-center gap-2">
            <ExternalLinkIcon aria-hidden="true" />
            {t("markdown.linkSafety.title")}
          </DialogTitle>
          <DialogDescription>{t("markdown.linkSafety.description")}</DialogDescription>
        </DialogHeader>
        <code className="max-h-32 overflow-auto rounded-lg bg-muted p-3 text-sm break-all">
          {url}
        </code>
        <DialogFooter closeLabel={t("markdown.close")} className="m-0">
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
            onClick={(event) => {
              const request = new CustomEvent("workbench:open-browser-link", {
                bubbles: true,
                cancelable: true,
                detail: { url },
              });
              if (event.currentTarget.dispatchEvent(request)) onConfirm();
              close();
            }}
          >
            <ExternalLinkIcon aria-hidden="true" data-icon="inline-start" />
            {t("markdown.linkSafety.open")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfiguredMarkdownText({
  text,
  defer = false,
  ...props
}: MarkdownTextProps & Readonly<{ text: string; renderDiagrams?: boolean }>) {
  const deferredText = useDeferredValue(text);
  return <RenderedMarkdownText {...props} text={defer ? deferredText : text} />;
}

const RenderedMarkdownText = memo(function RenderedMarkdownText({
  className,
  codeTheme,
  decorateLinks = false,
  inheritLineHeight = false,
  isRunning = false,
  mode = isRunning ? "streaming" : "static",
  preserveWhitespace = false,
  preprocess,
  renderDiagrams = true,
  resetParagraphMargins = false,
  smooth = false,
  text,
  ...props
}: MarkdownTextProps & Readonly<{ text: string; renderDiagrams?: boolean }>) {
  const { t } = useI18n(markdownTranslationBundle);
  const labels = useMemo(
    () => ({
      footnotes: t("markdown.document.footnotes"),
      backToReference: t("markdown.document.backToReference"),
    }),
    [t],
  );
  const processed = useMemo(() => {
    const normalized = normalizeMarkdownText(text);
    return preprocess?.(normalized) ?? normalized;
  }, [preprocess, text]);

  return (
    <div
      {...props}
      className={cn(
        "aui-markdown space-y-0 [&>*:first-child]:mt-0! [&>*:last-child]:mb-0!",
        inheritLineHeight &&
          "[&_p]:leading-[inherit]! [&_[data-markdown=list-item]]:leading-[inherit]!",
        preserveWhitespace && "[&_p]:whitespace-pre-wrap!",
        resetParagraphMargins && "[&_p]:m-0!",
        className,
      )}
    >
      <CodeThemeContext.Provider value={codeTheme}>
        <WorkbenchMarkdown
          text={processed}
          streaming={mode === "streaming" && isRunning}
          smooth={Boolean(smooth)}
          components={renderDiagrams ? markdownComponents : sourceCodeComponents}
          labels={labels}
          decorateLinks={decorateLinks}
        />
      </CodeThemeContext.Provider>
    </div>
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
      return result.text;
    },
    [],
  );

  return (
    <InlineCitationContext.Provider value={context}>
      <ConfiguredMarkdownText
        text={text}
        isRunning={isRunning}
        defer={isRunning}
        mode={isRunning ? "streaming" : "static"}
        preprocess={preprocess}
        decorateLinks
        smooth
      />
      {sources.length > 0 && preprocessInlineCitationMarkers(text).markerCount === 0 ? (
        <MarkdownSuperscript>{INLINE_CITATION_GROUP_SENTINEL}</MarkdownSuperscript>
      ) : null}
    </InlineCitationContext.Provider>
  );
});
