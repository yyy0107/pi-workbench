import assert from "node:assert/strict";
import test from "node:test";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkbenchSettingsProvider, type WorkbenchSettingsPort } from "../../settings";
import { MarkdownTextContent, MarkdownTextContentWithCitations } from "./markdown-text";

const settings = {
  async load() {
    return {};
  },
  async update() {},
} satisfies WorkbenchSettingsPort;

function render(node: ReactNode): string {
  return renderToStaticMarkup(
    createElement(WorkbenchSettingsProvider, { service: settings, children: node }),
  );
}

test("renders supported math delimiters without treating currency as math", () => {
  const markup = render(
    createElement(MarkdownTextContent, {
      text: "Price: $5. Math: $E = mc^2$ and \\(a^2 + b^2 = c^2\\).",
    }),
  );

  assert.equal(markup.match(/class="katex"/g)?.length, 2);
  assert.match(markup, /\$5/);
});

test("renders structured citations with stable accessible labels", () => {
  const markup = render(
    createElement(MarkdownTextContentWithCitations, {
      text: "Evidence-backed answer.",
      sources: [
        {
          domain: "example.com",
          title: "Example guide",
          snippet: "https://example.com/guide",
          url: "https://example.com/guide",
        },
      ],
    }),
  );

  assert.match(markup, /data-slot="inline-citation"/);
  assert.match(markup, /aria-label="Example guide"/);
});
