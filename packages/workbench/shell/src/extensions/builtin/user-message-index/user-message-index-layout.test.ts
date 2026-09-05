import assert from "node:assert/strict";
import test from "node:test";

import {
  getMessageElements,
  isMessageInViewport,
  MIN_COMPOSER_INDEX_GAP,
  resolveComposerIndexGap,
  shouldShowUserMessageIndex,
} from "./user-message-index-layout";

test("resolves all message seats in one scan and refreshes replaced seats", () => {
  let scans = 0;
  const elements = Array.from({ length: 200 }, (_, index) => ({
    dataset: { messageId: `message-${index}` },
  }));
  const root = {
    querySelectorAll(selector: string) {
      assert.equal(selector, "[data-message-id]");
      scans += 1;
      return elements;
    },
  } as unknown as HTMLElement;

  const lookup = getMessageElements(root);
  for (const element of elements) {
    assert.equal(lookup.get(element.dataset.messageId!), element);
  }
  assert.equal(lookup.get("missing"), undefined);
  assert.equal(scans, 1);

  elements[0] = { dataset: { messageId: 'message-with-"quotes"' } };
  const refreshed = getMessageElements(root);
  assert.equal(refreshed.get("message-0"), undefined);
  assert.equal(refreshed.get('message-with-"quotes"'), elements[0]);
  assert.equal(scans, 2);
});

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

test("detects user messages intersecting the scroll viewport", () => {
  const viewport = { top: 100, bottom: 300 };

  assert.equal(isMessageInViewport({ top: 50, bottom: 100 }, viewport), false);
  assert.equal(isMessageInViewport({ top: 50, bottom: 101 }, viewport), true);
  assert.equal(isMessageInViewport({ top: 299, bottom: 350 }, viewport), true);
  assert.equal(isMessageInViewport({ top: 300, bottom: 350 }, viewport), false);
});
