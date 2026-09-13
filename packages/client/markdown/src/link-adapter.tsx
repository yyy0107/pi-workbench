"use client";

import {
  createContext,
  useContext,
  useState,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";

export type MarkdownFileLinkProps = Omit<ComponentProps<"a">, "href"> & { readonly href: string };
export interface MarkdownLinkAdapter {
  readonly isLocalFileHref: (href: string) => boolean;
  readonly FileLink: ComponentType<MarkdownFileLinkProps>;
}
function SafeFileLink({ href, children, ...props }: MarkdownFileLinkProps) {
  const safe =
    // eslint-disable-next-line no-control-regex -- Reject URL control characters before scheme validation.
    !/[\u0000-\u001f]/u.test(href) &&
    (!/^[a-z][a-z\d+.-]*:/i.test(href) || /^(?:https?|mailto|tel|file):/i.test(href));
  return safe ? (
    <a {...props} href={href} rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );
}
const DEFAULT_MARKDOWN_LINK_ADAPTER: MarkdownLinkAdapter = Object.freeze({
  isLocalFileHref: () => false,
  FileLink: SafeFileLink,
});
const MarkdownLinkContext = createContext(DEFAULT_MARKDOWN_LINK_ADAPTER);

/** Freeze one classifier/renderer pair for the installation, including lazily loaded renderers. */
export function MarkdownLinkAdapterProvider({
  adapter,
  children,
}: Readonly<{ adapter: MarkdownLinkAdapter; children: ReactNode }>) {
  const [installed] = useState(() =>
    Object.freeze({ isLocalFileHref: adapter.isLocalFileHref, FileLink: adapter.FileLink }),
  );
  return <MarkdownLinkContext.Provider value={installed}>{children}</MarkdownLinkContext.Provider>;
}
export function useMarkdownLinkAdapter(): MarkdownLinkAdapter {
  return useContext(MarkdownLinkContext);
}
