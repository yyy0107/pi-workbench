import assert from "node:assert/strict";
import test from "node:test";

const {
  ATTACHMENT_RECOGNITION_DATA_PART_NAME,
  IMAGE_RECOGNITION_STAGES,
  IMAGE_RECOGNITION_STATUSES,
  LEGACY_IMAGE_RECOGNITION_DATA_PART_NAME,
  imageRecognitionErrorKind,
  imageRecognitionLiveRegion,
  imageRecognitionSkipKind,
  parseImageRecognitionPresentation,
} = (await import(
  new URL("./image-recognition-presentation.ts", import.meta.url).href
)) as typeof import("./image-recognition-presentation");

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    operationId: "recognition-1",
    submissionId: "submission-1",
    rpcId: "rpc-1",
    revision: 3,
    status: "running",
    stage: "recognizing",
    method: "ocr",
    providerId: "glm-ocr",
    attachmentCount: 3,
    completedCount: 1,
    progress: 1 / 3,
    ...overrides,
  };
}

test("uses an attachment-neutral data-part name while retaining the legacy image name", () => {
  assert.equal(ATTACHMENT_RECOGNITION_DATA_PART_NAME, "workbench.attachment-recognition");
  assert.equal(LEGACY_IMAGE_RECOGNITION_DATA_PART_NAME, "workbench.image-recognition");
});

test("parses every state and every running stage in the version-one FSM", () => {
  const states: Record<(typeof IMAGE_RECOGNITION_STATUSES)[number], Record<string, unknown>> = {
    pending: payload({
      revision: 0,
      status: "pending",
      stage: undefined,
      completedCount: 0,
      progress: 0,
    }),
    running: payload(),
    succeeded: payload({ status: "succeeded", stage: undefined, completedCount: 3, progress: 1 }),
    failed: payload({ status: "failed", stage: undefined, errorCode: "provider-timeout" }),
    cancelled: payload({ status: "cancelled", stage: undefined }),
    skipped: payload({ status: "skipped", stage: undefined }),
  };

  for (const status of IMAGE_RECOGNITION_STATUSES) {
    assert.equal(parseImageRecognitionPresentation(states[status])?.status, status);
  }

  for (const stage of IMAGE_RECOGNITION_STAGES) {
    const parsed = parseImageRecognitionPresentation(payload({ stage }));
    assert.equal(parsed?.status, "running");
    assert.equal(parsed?.stage, stage);
  }
});

test("normalizes progress from the canonical snapshot or completed attachment count", () => {
  assert.equal(parseImageRecognitionPresentation(payload({ progress: 0.75 }))?.progress, 0.75);
  assert.equal(
    parseImageRecognitionPresentation(
      payload({ attachmentCount: 5, completedCount: 2, progress: undefined }),
    )?.progress,
    0.4,
  );
});

test("projects bounded normalized recognition results without exposing operation metadata", () => {
  const parsed = parseImageRecognitionPresentation(
    payload({
      status: "succeeded",
      stage: undefined,
      attachmentCount: 2,
      completedCount: 2,
      progress: 1,
      results: [
        { attachmentId: "image-1", format: "markdown", text: "# Invoice" },
        { attachmentId: "pdf-1", format: "text", text: "Total: 42", truncated: true },
      ],
    }),
  );

  assert.deepEqual(parsed?.results, [
    {
      attachmentId: "image-1",
      referenceKind: "image",
      sequence: 1,
      format: "markdown",
      text: "# Invoice",
    },
    {
      attachmentId: "pdf-1",
      referenceKind: "pdf",
      sequence: 1,
      format: "text",
      text: "Total: 42",
      truncated: true,
    },
  ]);
  assert.equal("operationId" in (parsed ?? {}), false);
  assert.equal("submissionId" in (parsed ?? {}), false);
});

test("rejects raw provider fields, secrets, endpoints, and image bytes", () => {
  assert.equal(
    parseImageRecognitionPresentation(
      payload({
        endpoint: "https://ocr.example.test/v1",
        apiKey: "super-secret",
        text: "complete OCR output",
        image: "data:image/png;base64,abcdef",
        request: { authorization: "Bearer super-secret" },
      }),
    ),
    undefined,
  );

  assert.equal(
    parseImageRecognitionPresentation(
      payload({
        status: "succeeded",
        stage: undefined,
        attachmentCount: 1,
        completedCount: 1,
        progress: 1,
        results: [
          {
            attachmentId: "image-1",
            format: "text",
            text: "recognized",
            rawResponse: { authorization: "Bearer super-secret" },
          },
        ],
      }),
    ),
    undefined,
  );

  assert.equal(
    parseImageRecognitionPresentation(
      payload({
        status: "succeeded",
        stage: undefined,
        attachmentCount: 1,
        completedCount: 1,
        progress: 1,
        results: [
          {
            attachmentId: "image-1",
            format: "text",
            text: "recognized",
            truncated: false,
          },
        ],
      }),
    ),
    undefined,
  );

  const parsed = parseImageRecognitionPresentation(
    payload({
      providerId: "https://ocr.example.test/v1",
    }),
  );

  assert.ok(parsed);
  assert.equal(parsed.providerId, undefined);
});

test("maps stable failure codes without exposing unknown provider errors", () => {
  assert.equal(imageRecognitionErrorKind("invalid-credentials"), "authentication");
  assert.equal(imageRecognitionErrorKind("provider-authentication-failed"), "authentication");
  assert.equal(imageRecognitionErrorKind("provider-configuration-invalid"), "configuration");
  assert.equal(imageRecognitionErrorKind("provider-not-configured"), "configuration");
  assert.equal(imageRecognitionErrorKind("preprocessor-not-configured"), "configuration");
  assert.equal(imageRecognitionErrorKind("recognition-disabled"), "configuration");
  assert.equal(imageRecognitionErrorKind("image-settings-invalid"), "configuration");
  assert.equal(imageRecognitionErrorKind("image-settings-io"), "configuration");
  assert.equal(imageRecognitionErrorKind("provider-rate-limited"), "rateLimited");
  assert.equal(imageRecognitionErrorKind("provider-poll-timeout"), "timeout");
  assert.equal(imageRecognitionErrorKind("provider-network-error"), "network");
  assert.equal(imageRecognitionErrorKind("provider-unavailable"), "serviceUnavailable");
  assert.equal(imageRecognitionErrorKind("recognition-interrupted"), "serviceUnavailable");
  assert.equal(imageRecognitionErrorKind("native-model-required"), "unsupportedImage");
  assert.equal(imageRecognitionErrorKind("provider-invalid-input"), "unsupportedImage");
  assert.equal(imageRecognitionErrorKind("provider-invalid-response"), "invalidResponse");
  assert.equal(imageRecognitionErrorKind("vendor said: secret endpoint"), "generic");
  const failed = parseImageRecognitionPresentation(
    payload({
      status: "failed",
      stage: undefined,
      errorCode: "provider-poll-timeout",
      diagnostic: {
        phase: "polling",
        reason: "request-failed",
        httpStatus: 503,
        providerCode: "500",
      },
    }),
  );
  assert.equal(failed?.errorKind, "timeout");
  assert.equal(failed?.errorCode, "provider-poll-timeout");
  assert.deepEqual(failed?.diagnostic, {
    phase: "polling",
    reason: "request-failed",
    httpStatus: 503,
    providerCode: "500",
  });

  assert.equal(
    parseImageRecognitionPresentation(
      payload({
        status: "failed",
        stage: undefined,
        errorCode: "provider-invalid-response",
        diagnostic: {
          phase: "result-parsing",
          reason: "raw upstream response",
          responseBody: "secret",
        },
      }),
    ),
    undefined,
  );
});

test("uses an assertive alert only for failures and polite status updates otherwise", () => {
  for (const status of IMAGE_RECOGNITION_STATUSES) {
    assert.deepEqual(
      imageRecognitionLiveRegion(status),
      status === "failed"
        ? { role: "alert", live: "assertive" }
        : { role: "status", live: "polite" },
    );
  }
});

test("normalizes skipped states while keeping native recognition distinguishable", () => {
  assert.equal(imageRecognitionSkipKind("native", undefined, undefined), "native");
  assert.equal(imageRecognitionSkipKind("ocr", "recognition-disabled", undefined), "disabled");
  assert.equal(imageRecognitionSkipKind("ocr", undefined, "not-needed"), "notNeeded");
  assert.equal(
    parseImageRecognitionPresentation(
      payload({ status: "skipped", stage: undefined, method: "native" }),
    )?.skipKind,
    "native",
  );
});

test("rejects malformed envelopes and invalid state-machine transitions", () => {
  assert.equal(parseImageRecognitionPresentation(null), undefined);
  assert.equal(parseImageRecognitionPresentation(payload({ version: 2 })), undefined);
  assert.equal(parseImageRecognitionPresentation(payload({ operationId: "" })), undefined);
  assert.equal(parseImageRecognitionPresentation(payload({ status: "finished" })), undefined);
  assert.equal(parseImageRecognitionPresentation(payload({ method: "tool" })), undefined);
  assert.equal(parseImageRecognitionPresentation(payload({ attachmentCount: -1 })), undefined);
  assert.equal(
    parseImageRecognitionPresentation(
      payload({ attachmentCount: 2, completedCount: 9, progress: Number.POSITIVE_INFINITY }),
    ),
    undefined,
  );
  assert.equal(
    parseImageRecognitionPresentation(
      payload({ status: "succeeded", stage: undefined, completedCount: 2, progress: 0.5 }),
    ),
    undefined,
  );
});

test("normalizes persisted image-only snapshots through the compatibility seam", () => {
  const { attachmentCount, ...common } = payload();
  const parsed = parseImageRecognitionPresentation({ ...common, imageCount: attachmentCount });
  assert.equal(parsed?.attachmentCount, 3);
});

test("falls back to result order for persisted generic attachment identifiers", () => {
  const parsed = parseImageRecognitionPresentation(
    payload({
      status: "succeeded",
      stage: undefined,
      attachmentCount: 2,
      completedCount: 2,
      progress: 1,
      results: [
        { attachmentId: "attachment-4", format: "text", text: "legacy one" },
        { attachmentId: "attachment-7", format: "text", text: "legacy two" },
      ],
    }),
  );

  assert.deepEqual(
    parsed?.results.map(({ referenceKind, sequence }) => ({ referenceKind, sequence })),
    [
      { referenceKind: "attachment", sequence: 1 },
      { referenceKind: "attachment", sequence: 2 },
    ],
  );
});
