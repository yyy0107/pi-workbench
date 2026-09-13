import assert from "node:assert/strict";
import test from "node:test";
import { createElement, Fragment, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { I18nProvider } from "@workbench/i18n";
import { WorkbenchSettingsProvider, type WorkbenchSettingsPort } from "@workbench/settings-runtime";
import { codeHighlightingTranslationBundle } from "@workbench/code-highlighting/i18n";
import { markdownTranslationBundle } from "../src/i18n";
import { MarkdownTextContent as LazyMarkdownTextContent } from "../src/lazy-markdown-text";
import { MarkdownTextContent } from "../src/markdown-text";
import {
  MarkdownLinkAdapterProvider,
  type MarkdownFileLinkProps,
  type MarkdownLinkAdapter,
} from "../src/link-adapter";

const bundles = [codeHighlightingTranslationBundle, markdownTranslationBundle];
const service: WorkbenchSettingsPort = {
  async load() {
    return {};
  },
  async update() {},
};
function providers(children: ReactNode) {
  return createElement(WorkbenchSettingsProvider, {
    service,
    children: createElement(I18nProvider, {
      locale: "en-US",
      bundles,
      onLocaleChange() {},
      children,
    }),
  });
}
function adapter(id: string, basename: string): MarkdownLinkAdapter {
  return {
    isLocalFileHref: (href) => href === basename + ".ts:9" || href === "./" + basename + ".ts:9",
    FileLink: ({ href, children, ...props }: MarkdownFileLinkProps) =>
      createElement("a", { ...props, href, "data-adapter": id }, children),
  };
}
const text = "[first](first.ts:9) [second](second.ts:9)";

test("lazy rendering uses each installation's same classifier and file-link component", async () => {
  const one = createElement(
    "section",
    { "data-installation": "one" },
    createElement(MarkdownLinkAdapterProvider, {
      adapter: adapter("one", "first"),
      children: createElement(LazyMarkdownTextContent, { text, decorateLinks: true }),
    }),
  );
  const two = createElement(
    "section",
    { "data-installation": "two" },
    createElement(MarkdownLinkAdapterProvider, {
      adapter: adapter("two", "second"),
      children: createElement(LazyMarkdownTextContent, { text, decorateLinks: true }),
    }),
  );
  const stream = await renderToReadableStream(providers(createElement(Fragment, null, one, two)));
  await stream.allReady;
  const markup = await new Response(stream).text();
  // The opaque inline filenames need classification before sanitization to retain their colon.
  const rendered = [...markup.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*data-adapter="([^"]+)"/g)].map(
    (match) => [match[1], match[2]],
  );
  assert.deepEqual(rendered, [
    ["./first.ts:9", "one"],
    ["./second.ts:9", "two"],
  ]);
});

test("without workspace integration unsafe schemes and authored script elements remain filtered", async () => {
  const stream = await renderToReadableStream(
    providers(
      createElement(MarkdownTextContent, {
        text: '[local](./file.ts) <script>alert(1)</script> <a href="javascript:alert(1)">unsafe</a>',
        decorateLinks: true,
      }),
    ),
  );
  await stream.allReady;
  const markup = await new Response(stream).text();
  assert.doesNotMatch(markup, /data-adapter|workbench-file-link|<script\b|href="javascript:/);
  assert.match(markup, /local/);
});
