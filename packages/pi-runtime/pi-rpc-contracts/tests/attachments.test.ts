import assert from "node:assert/strict";
import test from "node:test";

import {
  INLINE_IMAGE_LIMITS,
  isInlineImageMediaType,
  isSessionAttachmentErrorReason,
} from "../src/attachments";

test("accepts only the declared inline image media types", () => {
  assert.equal(isInlineImageMediaType("image/png"), true);
  assert.equal(isInlineImageMediaType("image/svg+xml"), false);
});

test("preserves the stable inline attachment admission budgets", () => {
  assert.deepEqual(INLINE_IMAGE_LIMITS, {
    maxCount: 20,
    maxDecodedBytesPerImage: 10 * 1024 * 1024,
    maxDecodedBytesTotal: 25 * 1024 * 1024,
  });
});

test("recognizes image and session-level attachment failures", () => {
  assert.equal(isSessionAttachmentErrorReason("INVALID_IMAGE_BASE64"), true);
  assert.equal(isSessionAttachmentErrorReason("MODEL_DOES_NOT_SUPPORT_IMAGES"), true);
  assert.equal(isSessionAttachmentErrorReason("UNKNOWN_ATTACHMENT_FAILURE"), false);
});
