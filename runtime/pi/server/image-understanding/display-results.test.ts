import assert from "node:assert/strict";
import test from "node:test";

import { MAX_ATTACHMENT_RECOGNITION_RESULT_CHARACTERS } from "../../../image-understanding/state-machine";

import { projectAttachmentRecognitionResults } from "./display-results";

test("projects normalized observations without provider envelopes", () => {
  assert.deepEqual(
    projectAttachmentRecognitionResults([
      {
        attachmentId: "image-1",
        kind: "image",
        sequence: 1,
        providerId: "glm-ocr",
        method: "ocr",
        format: "markdown",
        text: "# Invoice\nTotal: 42",
      },
    ]),
    [{ attachmentId: "image-1", format: "markdown", text: "# Invoice\nTotal: 42" }],
  );
});

test("bounds the display copy across attachments while preserving every result", () => {
  const firstText = "a".repeat(MAX_ATTACHMENT_RECOGNITION_RESULT_CHARACTERS - 3);
  const projected = projectAttachmentRecognitionResults([
    {
      attachmentId: "image-1",
      kind: "image",
      sequence: 1,
      providerId: "glm-ocr",
      method: "ocr",
      format: "text",
      text: firstText,
    },
    {
      attachmentId: "image-2",
      kind: "image",
      sequence: 2,
      providerId: "paddleocr",
      method: "ocr",
      format: "markdown",
      text: "123456",
    },
    {
      attachmentId: "image-3",
      kind: "image",
      sequence: 3,
      providerId: "glm-ocr",
      method: "ocr",
      format: "text",
      text: "later image",
    },
  ]);

  assert.equal(projected.length, 3);
  assert.equal(projected[0]?.text, firstText);
  assert.equal(projected[0]?.truncated, undefined);
  assert.deepEqual(projected[1], {
    attachmentId: "image-2",
    format: "markdown",
    text: "123",
    truncated: true,
  });
  assert.deepEqual(projected[2], {
    attachmentId: "image-3",
    format: "text",
    text: "",
    truncated: true,
  });
  assert.equal(
    projected.reduce((total, result) => total + result.text.length, 0),
    MAX_ATTACHMENT_RECOGNITION_RESULT_CHARACTERS,
  );
});
