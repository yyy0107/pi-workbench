"use client";

import { MessagePartPrimitive } from "@assistant-ui/react";
import { lazy, Suspense, type ComponentProps } from "react";

export type { MarkdownTextProps } from "./markdown-text";

type MarkdownModule = typeof import("./markdown-text");

const LazyMarkdownText = lazy(async () => ({
  default: (await import("./markdown-text")).MarkdownText,
}));
const LazyMarkdownTextWithCitations = lazy(async () => ({
  default: (await import("./markdown-text")).MarkdownTextWithCitations,
}));
const LazyCompactMarkdownText = lazy(async () => ({
  default: (await import("./markdown-text")).CompactMarkdownText,
}));
const LazyMarkdownTextContent = lazy(async () => ({
  default: (await import("./markdown-text")).MarkdownTextContent,
}));
const LazyMarkdownCodeBlockContent = lazy(async () => ({
  default: (await import("./markdown-text")).MarkdownCodeBlockContent,
}));

// Streamdown pulls in Markdown parsing, Mermaid, KaTeX, and Shiki. Keep that graph out of the
// desktop shell's startup chunks and fetch it only when a surface actually renders rich text.
function MessageTextFallback() {
  return <MessagePartPrimitive.Text component="p" smooth={false} className="whitespace-pre-wrap" />;
}

export function MarkdownText() {
  return (
    <Suspense fallback={<MessageTextFallback />}>
      <LazyMarkdownText />
    </Suspense>
  );
}

export function MarkdownTextWithCitations(
  props: ComponentProps<MarkdownModule["MarkdownTextWithCitations"]>,
) {
  return (
    <Suspense fallback={<MessageTextFallback />}>
      <LazyMarkdownTextWithCitations {...props} />
    </Suspense>
  );
}

export function CompactMarkdownText() {
  return (
    <Suspense fallback={<MessageTextFallback />}>
      <LazyCompactMarkdownText />
    </Suspense>
  );
}

export function MarkdownTextContent(props: ComponentProps<MarkdownModule["MarkdownTextContent"]>) {
  return (
    <Suspense fallback={null}>
      <LazyMarkdownTextContent {...props} />
    </Suspense>
  );
}

export function MarkdownCodeBlockContent(
  props: ComponentProps<MarkdownModule["MarkdownCodeBlockContent"]>,
) {
  return (
    <Suspense fallback={null}>
      <LazyMarkdownCodeBlockContent {...props} />
    </Suspense>
  );
}
