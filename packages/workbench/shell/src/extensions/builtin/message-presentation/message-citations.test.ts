import assert from "node:assert/strict";
import test from "node:test";

import { messageCitationLayout } from "./message-citations";

test("attaches structured sources to the nearest preceding text part", () => {
  const layout = messageCitationLayout([
    { type: "text" },
    { type: "tool-call" },
    {
      type: "source",
      sourceType: "url",
      url: "https://www.example.com/guide",
      title: "Guide",
    },
    { type: "text" },
    {
      type: "source",
      sourceType: "document",
      title: "Architecture",
      filename: "architecture.pdf",
      mediaType: "application/pdf",
    },
  ]);

  assert.deepEqual(layout.byTextPart.get(0), [
    {
      domain: "example.com",
      title: "Guide",
      snippet: "https://www.example.com/guide",
      url: "https://www.example.com/guide",
    },
  ]);
  assert.deepEqual(layout.byTextPart.get(3), [
    {
      domain: "architecture.pdf",
      title: "Architecture",
      snippet: "architecture.pdf",
    },
  ]);
  assert.deepEqual([...layout.inlineSourcePartIndices], [2, 4]);
});

test("leaves unmappable and unsafe sources in the ordinary source renderer", () => {
  const layout = messageCitationLayout([
    {
      type: "source",
      sourceType: "url",
      url: "https://example.com/orphan",
      title: "Orphan",
    },
    { type: "text" },
    {
      type: "source",
      sourceType: "url",
      url: "javascript:alert(1)",
      title: "Unsafe",
    },
  ]);

  assert.equal(layout.byTextPart.size, 0);
  assert.equal(layout.inlineSourcePartIndices.size, 0);
});
