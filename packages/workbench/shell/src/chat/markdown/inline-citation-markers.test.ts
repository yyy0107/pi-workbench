import assert from "node:assert/strict";
import test from "node:test";

import {
  INLINE_CITATION_URL_SENTINEL_PREFIX,
  parseInlineCitationUrlSentinel,
  preprocessInlineCitationMarkers,
} from "./inline-citation-markers";

test("converts safe URL citation markers and assigns stable reference indices", () => {
  const firstUrl = "https://example.com/docs/primitives/message";
  const secondUrl = "https://example.org/docs/ui/streamdown";
  const result = preprocessInlineCitationMarkers(
    `First [[cite:${firstUrl}]] second [[cite:${secondUrl}]] again [[cite:${firstUrl}]]`,
  );

  assert.equal(result.markerCount, 3);
  assert.doesNotMatch(result.text, /\[\[cite:/);
  assert.match(
    result.text,
    new RegExp(`${INLINE_CITATION_URL_SENTINEL_PREFIX}0:0:${encodeURIComponent(firstUrl)}`),
  );
  assert.match(
    result.text,
    new RegExp(`${INLINE_CITATION_URL_SENTINEL_PREFIX}1:1:${encodeURIComponent(secondUrl)}`),
  );
  assert.match(
    result.text,
    new RegExp(`${INLINE_CITATION_URL_SENTINEL_PREFIX}0:2:${encodeURIComponent(firstUrl)}`),
  );
});

test("leaves citation examples inside code and unsafe URLs untouched", () => {
  const literal = "[[cite:https://example.com/literal]]";
  const unsafe = "[[cite:javascript:alert(1)]]";
  const result = preprocessInlineCitationMarkers(
    [`Inline \`${literal}\``, "```text", literal, "```", `    ${literal}`, unsafe].join("\n"),
  );

  assert.equal(result.markerCount, 0);
  assert.equal(result.text.match(/\[\[cite:/g)?.length, 4);
  assert.doesNotMatch(result.text, new RegExp(INLINE_CITATION_URL_SENTINEL_PREFIX));
});

test("parses only valid encoded citation sentinels", () => {
  const url = "https://example.com/guide?q=inline%20citation";
  assert.deepEqual(
    parseInlineCitationUrlSentinel(
      `${INLINE_CITATION_URL_SENTINEL_PREFIX}2:5:${encodeURIComponent(url)}`,
    ),
    { index: 2, occurrence: 5, url },
  );
  assert.equal(
    parseInlineCitationUrlSentinel(`${INLINE_CITATION_URL_SENTINEL_PREFIX}-1:0:x`),
    undefined,
  );
  assert.equal(
    parseInlineCitationUrlSentinel(
      `${INLINE_CITATION_URL_SENTINEL_PREFIX}0:0:${encodeURIComponent("javascript:alert(1)")}`,
    ),
    undefined,
  );
});
