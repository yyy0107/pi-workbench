import type { MarkdownLinkAdapter } from "@workbench/markdown/links";
import { FileLink } from "./file-link-component";
import { parseLocalFileHref } from "./file-link";
export const workspaceMarkdownLinkAdapter: MarkdownLinkAdapter = Object.freeze({
  FileLink,
  isLocalFileHref: (href: string) => Boolean(parseLocalFileHref(href)),
});
