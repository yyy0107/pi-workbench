import assert from "node:assert/strict";
import test from "node:test";

import { INLINE_IMAGE_LIMITS } from "@workbench/agent-runtime-pi-protocol/attachments";
import {
  admitInlineAttachments,
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

test("admits a canonical PDF alongside an image without forwarding it as native vision", () => {
  const pdf = Buffer.from("%PDF-1.7\nminimal fixture").toString("base64");
  assert.deepEqual(
    admitInlineAttachments([
      { type: "image", data: PNG_BASE64, mediaType: "image/png", name: "scan.png" },
      { type: "file", data: pdf, mediaType: "application/pdf", name: "invoice.pdf" },
    ]),
    {
      images: [{ type: "image", data: PNG_BASE64, mimeType: "image/png", name: "scan.png" }],
      documents: [{ type: "file", data: pdf, mimeType: "application/pdf", name: "invoice.pdf" }],
    },
  );
});

test("rejects mislabeled or malformed PDF attachments before recognition", () => {
  const notPdf = Buffer.from("not a pdf").toString("base64");
  assert.throws(
    () =>
      admitInlineAttachments([
        { type: "file", data: notPdf, mediaType: "application/pdf", name: "fake.pdf" },
      ]),
    expectedFailure("UNRECOGNIZED_DOCUMENT_FORMAT"),
  );
  assert.throws(
    () =>
      admitInlineAttachments([
        { type: "file", data: "%%%", mediaType: "application/pdf", name: "broken.pdf" },
      ]),
    expectedFailure("INVALID_DOCUMENT_BASE64"),
  );
});
