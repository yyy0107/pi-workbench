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
import { useEffect, useState, type ComponentProps } from "react";
import { loadWebsiteIcon } from "../website-icon";
import { FileLink } from "../../ui/file-link";
import { parseLocalFileHref } from "../../workspace-files/file-link";

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

type LinkNode = Extract<MarkdownNode, { type: "element" }>;

function visitLinks(node: MarkdownNode, visit: (link: LinkNode) => void): void {
  if (node.type === "element" && node.tagName === "a") visit(node);
  else if ("children" in node) node.children.forEach((child) => visitLinks(child, visit));
}

export function decorateMarkdownLinks() {
  return (tree: MarkdownNode) =>
    visitLinks(tree, (node) => {
      if (node.type === "element" && node.tagName === "a") {
        const href = node.properties.href;
        if (typeof href !== "string" || !href) return;
        if (parseLocalFileHref(href)) node.tagName = "workbench-file-link";
        // Linked images already provide their own visual content.
        if (node.children.some((child) => child.type === "element" && child.tagName === "img"))
          return;
        node.children.unshift({
          type: "element",
          tagName: "span",
          properties: { "data-markdown-link-icon": linkKind(href), "data-website-href": href },
          children: [],
        });
        return;
      }
    });
}

export function MarkdownFileLink({
  node: _node,
  href,
  ...props
}: ComponentProps<"a"> & { node?: unknown }) {
  return href ? (
    <FileLink {...props} href={href} data-markdown="link" />
  ) : (
    <span>{props.children}</span>
  );
}

export function MarkdownLinkIcon({
  node: _node,
  "data-markdown-link-icon": kind,
  "data-website-href": href,
  ...props
}: ComponentProps<"span"> & {
  node?: unknown;
  "data-markdown-link-icon"?: keyof typeof linkIcons;
  "data-website-href"?: string;
}) {
  const [loaded, setLoaded] = useState<{ href: string; src: string } | null>(null);
  useEffect(() => {
    if (kind !== "web" || !href) return;
    let active = true;
    void loadWebsiteIcon(href).then((src) => {
      if (active && src) setLoaded({ href, src });
    });
    return () => {
      active = false;
    };
  }, [kind, href]);
  if (kind === "web" && loaded && loaded.href === href) {
    return (
      <img
        src={loaded.src}
        alt=""
        aria-hidden="true"
        referrerPolicy="no-referrer"
        className="aui-markdown-link-icon"
        onError={() => setLoaded(null)}
      />
    );
  }
  const Icon = kind && linkIcons[kind];
  return Icon ? (
    <Icon aria-hidden="true" className="aui-markdown-link-icon" />
  ) : (
    <span {...props} />
  );
}
