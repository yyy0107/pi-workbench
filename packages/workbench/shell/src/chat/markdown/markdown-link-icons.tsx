import type { toJsxRuntime } from "hast-util-to-jsx-runtime";
import {
  FileTextIcon,
  FolderIcon,
  Globe2Icon,
  HashIcon,
  ImageIcon,
  Link2Icon,
  MailIcon,
} from "lucide-react";
import type { ComponentProps } from "react";
import { defaultRehypePlugins, type StreamdownProps } from "streamdown";

type MarkdownNode = Parameters<typeof toJsxRuntime>[0];

const linkIcons = {
  file: FileTextIcon,
  folder: FolderIcon,
  web: Globe2Icon,
  image: ImageIcon,
  anchor: HashIcon,
  email: MailIcon,
  link: Link2Icon,
};

function linkKind(href: string): keyof typeof linkIcons {
  if (href.startsWith("#")) return "anchor";
  if (/^mailto:/i.test(href)) return "email";
  let path = href.split(/[?#]/, 1)[0];
  try {
    path = decodeURIComponent(new URL(href, "file:///").pathname);
  } catch {
    // Incomplete escapes can arrive while the model is streaming.
  }
  if (/\.(?:avif|bmp|gif|heic|heif|ico|jpe?g|jxl|png|svg|tiff?|webp)$/i.test(path)) return "image";
  if (/^(?:https?:)?\/\//i.test(href)) return "web";
  if (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^(?:file:|sandbox:|[a-z]:[\\/])/i.test(href))
    return "link";
  return /[\\/]$/.test(path) ? "folder" : "file";
}

// Decorate the parsed content so Streamdown continues to own link safety and clicks.
function rehypeLinkIcons() {
  return function visit(node: MarkdownNode): void {
    if (node.type === "element" && node.tagName === "a") {
      const href = node.properties.href;
      if (typeof href !== "string" || !href || href === "streamdown:incomplete-link") return;
      // Linked images already provide their own visual content.
      if (node.children.some((child) => child.type === "element" && child.tagName === "img"))
        return;
      node.children.unshift({
        type: "element",
        tagName: "span",
        properties: { "data-markdown-link-icon": linkKind(href) },
        children: [],
      });
      return;
    }
    if ("children" in node) node.children.forEach(visit);
  };
}

export const markdownLinkIconPlugins = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
  rehypeLinkIcons,
  defaultRehypePlugins.harden,
] satisfies StreamdownProps["rehypePlugins"];

export function MarkdownLinkIcon({
  node: _node,
  "data-markdown-link-icon": kind,
  ...props
}: ComponentProps<"span"> & {
  node?: unknown;
  "data-markdown-link-icon"?: keyof typeof linkIcons;
}) {
  const Icon = kind && linkIcons[kind];
  return Icon ? (
    <Icon aria-hidden="true" className="aui-markdown-link-icon" />
  ) : (
    <span {...props} />
  );
}
