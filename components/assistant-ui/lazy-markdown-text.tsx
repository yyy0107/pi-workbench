"use client";

import dynamic from "next/dynamic";

export type { MarkdownTextProps } from "./markdown-text";

const loading = () => null;

// Streamdown pulls in Markdown parsing, Mermaid, KaTeX, and Shiki. Keep that graph out of the
// desktop shell's startup chunks and fetch it only when a surface actually renders rich text.
export const MarkdownText = dynamic(
  () => import("./markdown-text").then((module) => module.MarkdownText),
  { ssr: false, loading },
);

export const MarkdownTextWithCitations = dynamic(
  () => import("./markdown-text").then((module) => module.MarkdownTextWithCitations),
  { ssr: false, loading },
);

export const CompactMarkdownText = dynamic(
  () => import("./markdown-text").then((module) => module.CompactMarkdownText),
  { ssr: false, loading },
);

export const MarkdownTextContent = dynamic(
  () => import("./markdown-text").then((module) => module.MarkdownTextContent),
  { ssr: false, loading },
);

export const MarkdownCodeBlockContent = dynamic(
  () => import("./markdown-text").then((module) => module.MarkdownCodeBlockContent),
  { ssr: false, loading },
);
