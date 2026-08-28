import assert from "node:assert/strict";
import test from "node:test";

import { TextMessagePartProvider } from "@assistant-ui/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MarkdownText, MarkdownTextWithCitations } from "./markdown-text";

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
