import assert from "node:assert/strict";
import test from "node:test";

import { INLINE_IMAGE_LIMITS } from "@workbench/agent-runtime-pi-protocol/attachments";
import {
  admitInlineImages,
  InlineImageAdmissionError,
} from "../../src/sessions/inline-image-admission";

const PNG_BASE64 = "iVBORw0KGgo=";

function expectedFailure(reason: InlineImageAdmissionError["reason"]): {
  name: string;
  reason: InlineImageAdmissionError["reason"];
} {
  return { name: "InlineImageAdmissionError", reason };
}

test("admits a canonical supported inline image", () => {
  assert.deepEqual(
    admitInlineImages([{ data: PNG_BASE64, mediaType: "image/png", name: "screenshot.png" }]),
    [
      {
        type: "image",
        data: PNG_BASE64,
        mimeType: "image/png",
        name: "screenshot.png",
      },
    ],
  );
});

test("rejects unsupported MIME types before images reach a session", () => {
  assert.throws(
    () => admitInlineImages([{ data: PNG_BASE64, mediaType: "image/svg+xml" }]),
    expectedFailure("UNSUPPORTED_IMAGE_MEDIA_TYPE"),
  );
});

test("rejects non-canonical base64 before images reach a session", () => {
  assert.throws(
    () =>
      admitInlineImages([{ data: "data:image/png;base64,iVBORw0KGgo=", mediaType: "image/png" }]),
    expectedFailure("INVALID_IMAGE_BASE64"),
  );
});

test("rejects an inline image over the per-image decoded byte limit", () => {
  const decodedBytes = INLINE_IMAGE_LIMITS.maxDecodedBytesPerImage + 1;
  const encodedLength = Math.ceil(decodedBytes / 3) * 4;
  const oversizedCanonicalBase64 = "A".repeat(encodedLength - 1) + "=";

  assert.throws(
    () => admitInlineImages([{ data: oversizedCanonicalBase64, mediaType: "image/png" }]),
    expectedFailure("INLINE_IMAGE_TOO_LARGE"),
  );
});
