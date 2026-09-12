import type {
  MarkdownElement as Element,
  MarkdownHastRoot as HastRoot,
  MarkdownRoot as Root,
  MarkdownNode as RootContent,
} from "./markdown-types";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { mathFromMarkdown } from "mdast-util-math";
import { toHast } from "mdast-util-to-hast";
import { gfm } from "micromark-extension-gfm";
import { math } from "micromark-extension-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { unified } from "unified";

import { parseLocalFileHref } from "../../workspace-files/file-link";

export function parseMarkdown(text: string): Root {
  return fromMarkdown(text, {
    extensions: [gfm(), math({ singleDollarTextMath: true })],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  });
}

// References and raw HTML can affect earlier blocks. Prefer a correct full parse
// over freezing a prefix whose meaning still depends on the rest of the document.
export function needsDocumentParse(text: string): boolean {
  return /^ {0,3}\[[^\]\n]+\]:/m.test(text) || /^ {0,3}<[/!a-z]/im.test(text);
}

export function visitElements(tree: HastRoot | Element, visit: (node: Element) => void): void {
  if (tree.type === "element") visit(tree);
  for (const child of tree.children) {
    if (child.type === "element") visitElements(child, visit);
  }
}

const raw = unified().use(rehypeRaw);
const sanitize = unified().use(rehypeSanitize, {
  ...defaultSchema,
  // IDs are scoped to the message before sanitizing, including authored HTML.
  clobber: [],
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "file"],
  },
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", /^language-./, "math-inline", "math-display"],
    ],
  },
});
const katex = unified().use(rehypeKatex, { trust: false, strict: "ignore" });

const slots: Record<string, string> = {
  h1: "heading-1",
  h2: "heading-2",
  h3: "heading-3",
  h4: "heading-4",
  h5: "heading-5",
  h6: "heading-6",
  ul: "unordered-list",
  ol: "ordered-list",
  li: "list-item",
  blockquote: "blockquote",
  table: "table",
  thead: "table-header",
  tbody: "table-body",
  tr: "table-row",
  th: "table-header-cell",
  td: "table-cell",
};

export interface MarkdownLabels {
  footnotes: string;
  backToReference: string;
}

export function markdownToHast(
  node: RootContent | Root,
  labels: MarkdownLabels,
  idPrefix: string,
): HastRoot {
  const root: Root = node.type === "root" ? node : { type: "root", children: [node] };
  const tree = raw.runSync(
    toHast(root, {
      allowDangerousHtml: true,
      clobberPrefix: "",
      footnoteLabel: labels.footnotes,
      footnoteBackLabel: labels.backToReference,
    }) as HastRoot,
  ) as HastRoot;
  visitElements(tree, (element) => {
    const properties = element.properties;
    for (const field of ["id", "name"]) {
      if (typeof properties[field] === "string")
        properties[field] = `${idPrefix}${properties[field]}`;
    }
    if (properties.ariaDescribedBy) {
      properties.ariaDescribedBy = String(properties.ariaDescribedBy)
        .split(/\s+/)
        .map((id) => `${idPrefix}${id}`);
    }
    const href = properties.href;
    if (typeof href !== "string") return;
    if (href.startsWith("#")) properties.href = `#${idPrefix}${href.slice(1)}`;
    else if (/^[a-z]:[\\/]/i.test(href)) properties.href = `file:///${href.replaceAll("\\", "/")}`;
    else if (!/^file:/i.test(href) && /^[^/]+:/.test(href) && parseLocalFileHref(href))
      properties.href = `./${href}`;
  });
  // Sanitize authored HTML before adding trusted math markup or internal node tags.
  const safe = sanitize.runSync(tree) as HastRoot;
  const rendered = katex.runSync(safe) as HastRoot;
  visitElements(rendered, (element) => {
    const slot = slots[element.tagName];
    if (slot) element.properties.dataMarkdown = slot;
    if (element.tagName === "pre") {
      const code = element.children.find(
        (child) => child.type === "element" && child.tagName === "code",
      );
      if (code?.type === "element") {
        code.properties.dataBlock = "true";
        const last = code.children.at(-1);
        if (last?.type === "text" && last.value.endsWith("\n"))
          last.value = last.value.slice(0, -1);
      }
    }
  });
  return rendered;
}

export function isUnclosedFence(source: string): boolean {
  const opening = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(source);
  if (!opening) return false;
  const marker = opening[1];
  const close = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \\t]*\\r?$`, "m");
  return !close.test(source.slice(opening[0].length));
}
