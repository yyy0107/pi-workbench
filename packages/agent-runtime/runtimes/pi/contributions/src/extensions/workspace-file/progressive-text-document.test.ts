import assert from "node:assert/strict";
import test from "node:test";

import {
  isLargeTextFile,
  LARGE_TEXT_FILE_THRESHOLD_BYTES,
  ProgressiveTextDocument,
} from "./progressive-text-document";

test("assembles lines progressively across chunks and CRLF boundaries", () => {
  const document = new ProgressiveTextDocument(18);
  document.append("first\r", 6);
  assert.equal(document.snapshot().lineCount, 1);
  assert.equal(document.lineAt(0), "first");

  document.append("\nsecond\nthi", 15);
  assert.equal(document.snapshot().lineCount, 3);
  assert.deepEqual(
    [document.lineAt(0), document.lineAt(1), document.lineAt(2)],
    ["first", "second", "thi"],
  );

  document.append("rd", 17);
  document.finish(17, 17);
  assert.deepEqual(
    [document.lineAt(0), document.lineAt(1), document.lineAt(2)],
    ["first", "second", "third"],
  );
  assert.deepEqual(document.snapshot(), {
    lineCount: 3,
    longestLineLength: 6,
    loadedBytes: 17,
    totalBytes: 17,
  });
});

test("preserves the final empty line and an empty file", () => {
  const withTrailingNewline = new ProgressiveTextDocument();
  withTrailingNewline.append("one\n", 4);
  withTrailingNewline.finish();
  assert.equal(withTrailingNewline.snapshot().lineCount, 2);
  assert.equal(withTrailingNewline.lineAt(1), "");

  const empty = new ProgressiveTextDocument(0);
  empty.finish(0, 0);
  assert.equal(empty.snapshot().lineCount, 1);
  assert.equal(empty.lineAt(0), "");
});

test("uses one shared byte threshold for progressive large-text rendering", () => {
  assert.equal(isLargeTextFile(LARGE_TEXT_FILE_THRESHOLD_BYTES - 1), false);
  assert.equal(isLargeTextFile(LARGE_TEXT_FILE_THRESHOLD_BYTES), true);
});
