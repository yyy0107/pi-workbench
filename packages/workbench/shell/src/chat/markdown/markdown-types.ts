import type { fromMarkdown } from "mdast-util-from-markdown";
import type { toJsxRuntime } from "hast-util-to-jsx-runtime";

// Derive AST types from the parser/renderer APIs that own them.
export type MarkdownRoot = ReturnType<typeof fromMarkdown>;
export type MarkdownNode = MarkdownRoot["children"][number];
export type MarkdownCodeNode = Extract<MarkdownNode, { type: "code" }>;
type HastNode = Parameters<typeof toJsxRuntime>[0];
export type MarkdownHastRoot = Extract<HastNode, { type: "root" }>;
export type MarkdownElement = Extract<HastNode, { type: "element" }>;
export type MarkdownHastContent = MarkdownHastRoot["children"][number];
