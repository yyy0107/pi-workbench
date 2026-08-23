import assert from "node:assert/strict";
import test from "node:test";

import { ProgressiveTextDocument } from "./progressive-text-document";
import { createVirtualizedCodeWindow } from "./virtualized-code-window";

function textDocument(lines: readonly string[]): ProgressiveTextDocument {
  const text = lines.join("\n");
  const document = new ProgressiveTextDocument(text.length);
  document.append(text, text.length, text.length);
  document.finish(text.length, text.length);
  return document;
}

test("aligns visible highlighting to reusable virtual pages", () => {
  const document = textDocument(
    Array.from({ length: 180 }, (_, index) => `const row${index} = ${index};`),
  );
  const window = createVirtualizedCodeWindow(document, 70, 95, 180);

  assert.equal(window?.startLine, 64);
  assert.equal(window?.endLine, 96);
  assert.equal(window?.highlightedLineLengths.length, 32);
  assert.match(window?.code ?? "", /^const row64 = 64;/);
  assert.match(window?.contextCode ?? "", /const row63 = 63;$/);
});

test("bounds syntax work without dropping the original long line", () => {
  const longLine = `const value = "${"x".repeat(40_000)}";`;
  const document = textDocument([longLine]);
  const window = createVirtualizedCodeWindow(document, 0, 0, 1);

  assert.ok((window?.highlightedLineLengths[0] ?? 0) < longLine.length);
  assert.ok((window?.code.length ?? 0) <= 4 * 1024);
  assert.equal(document.lineAt(0), longLine);
  assert.equal(window?.code.length, window?.highlightedLineLengths[0]);
});

test("reuses unused line budget for a long line in a mixed page", () => {
  const longLine = `const value = "${"x".repeat(40_000)}";`;
  const document = textDocument([longLine, ...Array.from({ length: 31 }, () => "")]);
  const window = createVirtualizedCodeWindow(document, 0, 31, 32);

  assert.equal(window?.highlightedLineLengths[0], 4 * 1024);
  assert.ok((window?.code.length ?? 0) <= 16 * 1024);
});
