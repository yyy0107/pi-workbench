import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { StreamingText } from "./streaming-text";

test("highlights four consecutive multilingual words", () => {
  const markup = renderToStaticMarkup(
    createElement(StreamingText, {
      segments: [{ text: "alpha beta 一二三四五六七八九十" }],
      count: Number.POSITIVE_INFINITY,
      streaming: true,
      granularity: "multilingual-word",
    }),
  );

  assert.equal(markup.match(/fade-in animate-in/g)?.length, 8);
  assert.equal(markup.match(/text-blue-500/g)?.length, 4);
  assert.match(markup, /bg-blue-500/);
  assert.match(markup, /aria-hidden="true"/);
  assert.doesNotMatch(markup, />一二三<\/span> <span/);
});

test("keeps the color transition while the final words settle", () => {
  const markup = renderToStaticMarkup(
    createElement(StreamingText, {
      segments: [{ text: "一二三四五六七八九十" }],
      count: Number.POSITIVE_INFINITY,
      streaming: false,
      granularity: "multilingual-word",
    }),
  );

  assert.match(markup, /transition-colors duration-700/);
  assert.doesNotMatch(markup, /text-blue-500|bg-blue-500/);
});
