import assert from "node:assert/strict";
import test from "node:test";

import { TextMessagePartProvider } from "@assistant-ui/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MarkdownText, MarkdownTextContent, MarkdownTextWithCitations } from "./markdown-text";

test("renders inline, display, and bracket-delimited math with KaTeX", () => {
  const markup = renderToStaticMarkup(
    createElement(MarkdownTextContent, {
      text: [
        "Inline: $E = mc^2$ and \\(a^2 + b^2 = c^2\\).",
        "",
        "$$",
        "\\int_0^1 x^2 \\, dx",
        "$$",
      ].join("\n"),
    }),
  );

  assert.equal(markup.match(/class="katex"/g)?.length, 3);
  assert.match(markup, /class="katex-display"/);
  assert.doesNotMatch(markup, /\\\(a\^2/);
});

test("does not interpret currency as inline math", () => {
  const markup = renderToStaticMarkup(
    createElement(MarkdownTextContent, {
      text: "The price changed from $5 to $10, while $x = 5$ remains math.",
    }),
  );

  assert.equal(markup.match(/class="katex"/g)?.length, 1);
  assert.match(markup, /\$5 to \$10/);
});

test("preserves multiline display math inside list items", () => {
  const markup = renderToStaticMarkup(
    createElement(MarkdownTextContent, {
      text: [
        "- **常微分方程**：只有一个自变量，例如时间 \\(t\\)",
        "  \\[",
        "  y'=2y",
        "  \\]",
        "",
        "- **偏微分方程**：有多个自变量，例如位置和时间",
        "  \\[",
        "  \\frac{\\partial u}{\\partial t}",
        "  =k\\frac{\\partial^2u}{\\partial x^2}",
        "  \\]",
        "  这可以描述热量传播。",
      ].join("\n"),
    }),
  );

  assert.equal(markup.match(/class="katex-display"/g)?.length, 2);
  assert.equal(markup.match(/class="katex"/g)?.length, 3);
  assert.doesNotMatch(markup, /\}\$\$/);
});

test("renders URL citation markers as numbered inline citations", () => {
  const markup = renderToStaticMarkup(
    createElement(
      TextMessagePartProvider,
      {
        text: [
          "Message parts. [[cite:https://www.assistant-ui.com/docs/primitives/message]]",
          "Streamdown. [[cite:https://www.assistant-ui.com/docs/ui/streamdown]]",
        ].join("\n\n"),
        isRunning: false,
      },
      createElement(MarkdownText),
    ),
  );

  assert.match(markup, /Message parts\./);
  assert.match(markup, /Streamdown\./);
  assert.match(markup, />1<\/button>/);
  assert.match(markup, />2<\/button>/);
  assert.equal(markup.match(/data-slot="inline-citation"/g)?.length, 2);
  assert.doesNotMatch(markup, /\[\[cite:/);
  assert.doesNotMatch(markup, /workbench-inline-citation-url/);
});

test("renders structured citations inside assistant markdown", () => {
  const markup = renderToStaticMarkup(
    createElement(
      TextMessagePartProvider,
      { text: "Evidence-backed answer.", isRunning: false },
      createElement(MarkdownTextWithCitations, {
        sources: [
          {
            domain: "example.com",
            title: "Example guide",
            snippet: "https://example.com/guide",
            url: "https://example.com/guide",
          },
        ],
      }),
    ),
  );

  assert.match(markup, /Evidence-backed answer\./);
  assert.match(markup, /data-slot="inline-citation"/);
  assert.match(markup, /aria-label="Example guide"/);
  assert.match(markup, />1<\/button>/);
  assert.doesNotMatch(markup, /workbench-inline-citations/);
});
