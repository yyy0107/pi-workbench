import assert from "node:assert/strict";
import test from "node:test";

import {
  INLINE_ATTACHMENT_LIMITS,
  INLINE_IMAGE_LIMITS,
  isInlineDocumentMediaType,
  isInlineImageMediaType,
  isSessionAttachmentErrorReason,
} from "../src/attachments";

test("accepts only the declared inline attachment media types", () => {
  assert.equal(isInlineImageMediaType("image/png"), true);
  assert.equal(isInlineImageMediaType("image/svg+xml"), false);
  assert.equal(isInlineDocumentMediaType("application/pdf"), true);
  assert.equal(isInlineDocumentMediaType("text/plain"), false);
});

test("preserves the stable inline attachment admission budgets", () => {
  assert.deepEqual(INLINE_IMAGE_LIMITS, {
    maxCount: 20,
    maxDecodedBytesPerImage: 10 * 1024 * 1024,
    maxDecodedBytesTotal: 25 * 1024 * 1024,
  });
  assert.deepEqual(INLINE_ATTACHMENT_LIMITS, {
    maxCount: 20,
    maxDecodedBytesPerDocument: 50 * 1024 * 1024,
    maxDecodedBytesTotal: 50 * 1024 * 1024,
  });
});

test("recognizes image, document, and session-level attachment failures", () => {
  assert.equal(isSessionAttachmentErrorReason("INVALID_IMAGE_BASE64"), true);
  assert.equal(isSessionAttachmentErrorReason("INVALID_DOCUMENT_BASE64"), true);
  assert.equal(isSessionAttachmentErrorReason("MODEL_DOES_NOT_SUPPORT_IMAGES"), true);
  assert.equal(isSessionAttachmentErrorReason("UNKNOWN_ATTACHMENT_FAILURE"), false);
});
