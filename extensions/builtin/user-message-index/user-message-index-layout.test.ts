import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_COMPOSER_INDEX_GAP,
  resolveComposerIndexGap,
  shouldShowUserMessageIndex,
} from "./user-message-index-layout";

test("measures the available overlay gap from the thread edge to the composer", () => {
  assert.equal(resolveComposerIndexGap({ composerStart: 100, threadStart: 20 }), 80);
});

test("shows the user message index only beyond the minimum composer gap", () => {
  assert.equal(
    shouldShowUserMessageIndex({
      composerStart: MIN_COMPOSER_INDEX_GAP,
      threadStart: 0,
    }),
    false,
  );
  assert.equal(
    shouldShowUserMessageIndex({
      composerStart: MIN_COMPOSER_INDEX_GAP + 1,
      threadStart: 0,
    }),
    true,
  );
});

test("keeps the user message index hidden for invalid measurements", () => {
  assert.equal(
    shouldShowUserMessageIndex({
      composerStart: Number.NaN,
      threadStart: 0,
    }),
    false,
  );
});

test("keeps the user message index hidden after the responsive layout releases its gutter", () => {
  assert.equal(
    shouldShowUserMessageIndex({
      composerStart: MIN_COMPOSER_INDEX_GAP + 100,
      threadStart: 0,
      layoutAllowsIndex: false,
    }),
    false,
  );
});
