import assert from "node:assert/strict";
import test from "node:test";

import { inferComposerAttachmentMediaType } from "../src/browser/composer-attachment";

const PNG_BASE64 = "iVBORw0KGgo=";

test("recognizes clipboard images whose browser MIME type is generic", () => {
  assert.equal(
    inferComposerAttachmentMediaType(
      "image.png",
      "application/octet-stream",
      `data:application/octet-stream;base64,${PNG_BASE64}`,
    ),
    "image/png",
  );
});

test("falls back to image extensions without reclassifying declared documents", () => {
  assert.equal(
    inferComposerAttachmentMediaType("capture.jpg", "", "data:;base64,AA=="),
    "image/jpeg",
  );
  assert.equal(
    inferComposerAttachmentMediaType(
      "renamed.png",
      "application/pdf",
      "data:application/pdf;base64,JVBERg==",
    ),
    "application/pdf",
  );
});
