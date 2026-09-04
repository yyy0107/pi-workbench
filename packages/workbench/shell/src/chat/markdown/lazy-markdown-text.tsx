"use client";

import { lazy, Suspense, type ComponentProps } from "react";

export type { MarkdownTextProps } from "./markdown-text";

type MarkdownModule = typeof import("./markdown-text");

const LazyMarkdownTextContent = lazy(async () => ({
  default: (await import("./markdown-text")).MarkdownTextContent,
}));
const LazyMarkdownTextContentWithCitations = lazy(async () => ({
  default: (await import("./markdown-text")).MarkdownTextContentWithCitations,
}));
const LazyMarkdownCodeBlockContent = lazy(async () => ({
  default: (await import("./markdown-text")).MarkdownCodeBlockContent,
}));

export function MarkdownTextContent(props: ComponentProps<MarkdownModule["MarkdownTextContent"]>) {
  return (
    <Suspense fallback={<p className="whitespace-pre-wrap">{props.text}</p>}>
      <LazyMarkdownTextContent {...props} />
    </Suspense>
  );
}

export function MarkdownTextContentWithCitations(
  props: ComponentProps<MarkdownModule["MarkdownTextContentWithCitations"]>,
) {
  return (
    <Suspense fallback={<p className="whitespace-pre-wrap">{props.text}</p>}>
      <LazyMarkdownTextContentWithCitations {...props} />
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
