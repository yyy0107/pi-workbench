"use client";

import type {
  MarkdownElement as Element,
  MarkdownHastRoot as HastRoot,
  MarkdownHastContent as HastContent,
  MarkdownRoot as Root,
  MarkdownNode as RootContent,
} from "./markdown-types";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment, createContext, memo, useId, useMemo, useRef } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import remend from "remend";

import { useMediaQuery } from "../../hooks/use-media-query";
import { IncrementalMarkdownParser } from "./incremental-markdown";
import { decorateMarkdownLinks } from "./markdown-link-icons";
import { MarkdownRevealClock, MarkdownRevealContext, MarkdownRevealText } from "./markdown-reveal";
import {
  isUnclosedFence,
  markdownToHast,
  needsDocumentParse,
  parseMarkdown,
  type MarkdownLabels,
} from "./markdown-pipeline";

export type MarkdownComponents = NonNullable<Parameters<typeof toJsxRuntime>[1]["components"]>;
export const MarkdownFenceContext = createContext(false);

function revealLeaves(tree: HastRoot | Element): void {
  if (
    tree.type === "element" &&
    (["code", "pre", "sup", "svg", "math", "script", "style"].includes(tree.tagName) ||
      String(tree.properties.className ?? "").includes("katex"))
  )
    return;
  tree.children = tree.children.map((child): HastContent => {
    if (child.type === "text" && child.value.trim()) {
      return {
        type: "element",
        tagName: "workbench-reveal-text",
        properties: {},
        children: [child],
      };
    }
    if (child.type === "element") revealLeaves(child);
    return child;
  });
}

const MarkdownBlock = memo(function MarkdownBlock({
  node,
  source,
  streaming,
  components,
  labels,
  idPrefix,
  decorateLinks,
}: {
  node: RootContent | Root;
  source: string;
  streaming: boolean;
  components: MarkdownComponents;
  labels: MarkdownLabels;
  idPrefix: string;
  decorateLinks: boolean;
}) {
  const content = useMemo(() => {
    // Repair only unfinished prose in the active tail. Code and frozen blocks
    // never pass through repair or through a second Markdown parse.
    const repaired =
      streaming && node.type === "paragraph" ? remend(source, { linkMode: "text-only" }) : source;
    const document = repaired !== source ? parseMarkdown(repaired) : node;
    const tree = markdownToHast(document, labels, idPrefix);
    if (decorateLinks) decorateMarkdownLinks()(tree);
    revealLeaves(tree);
    return toJsxRuntime(tree, {
      Fragment,
      jsx,
      jsxs,
      passNode: true,
      components: {
        ...components,
        "workbench-reveal-text": MarkdownRevealText,
      } as MarkdownComponents,
    });
  }, [node, source, streaming, components, labels, idPrefix, decorateLinks]);
  const incomplete = streaming && (node.type !== "code" || isUnclosedFence(source));
  return (
    <MarkdownFenceContext.Provider value={incomplete}>{content}</MarkdownFenceContext.Provider>
  );
});

export function WorkbenchMarkdown({
  text,
  streaming,
  smooth,
  components,
  labels,
  decorateLinks = false,
}: {
  text: string;
  streaming: boolean;
  smooth: boolean;
  components: MarkdownComponents;
  labels: MarkdownLabels;
  decorateLinks?: boolean;
}) {
  const parser = useRef<IncrementalMarkdownParser | null>(null);
  parser.current ??= new IncrementalMarkdownParser(parseMarkdown);
  const clock = useMemo(() => new MarkdownRevealClock(), []);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const id = useId();
  const idPrefix = `wb-md-${id.replace(/[^a-zA-Z0-9_-]/g, "")}-`;
  const blocks = useMemo(() => {
    if (!streaming || needsDocumentParse(text)) {
      // Preserve source keys on finalization so code surfaces keep scroll/copy
      // state. Documents with references need one tree for global resolution.
      const root = parseMarkdown(text);
      if (needsDocumentParse(text)) return [{ node: root, key: 0, source: text, streaming }];
      return root.children.map((node, index) => ({
        node,
        key: node.position?.start.offset ?? index,
        source: text.slice(node.position?.start.offset, node.position?.end.offset),
        streaming: false,
      }));
    }
    const result = parser.current!.update(text);
    return [
      ...result.frozen.map((block) => ({ ...block, streaming: false })),
      ...result.tail.map((block) => ({ ...block, streaming: true })),
    ].map((block) => ({
      ...block,
      source: text.slice(
        block.key,
        block.key +
          ((block.node.position?.end.offset ?? 0) - (block.node.position?.start.offset ?? 0)),
      ),
    }));
  }, [text, streaming]);

  return (
    <MarkdownRevealContext.Provider value={streaming && smooth && !reducedMotion ? clock : null}>
      {blocks.map(({ key, ...block }) => (
        <MarkdownBlock
          key={key}
          {...block}
          components={components}
          labels={labels}
          idPrefix={idPrefix}
          decorateLinks={decorateLinks}
        />
      ))}
    </MarkdownRevealContext.Provider>
  );
}
