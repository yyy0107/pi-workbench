import assert from "node:assert/strict";
import test from "node:test";

import {
  attachmentReferenceId,
  isAttachmentRecognitionSnapshot,
  IMAGE_RECOGNITION_STAGES,
  ImageRecognitionTransitionError,
  isImageRecognitionSnapshot,
  isTerminalImageRecognitionSnapshot,
  MAX_IMAGE_RECOGNITION_RESULT_CHARACTERS,
  parseAttachmentRecognitionSnapshot,
  parseAttachmentReferenceId,
  parseImageRecognitionSnapshot,
  reconcileImageRecognitionSnapshot,
  reduceAttachmentRecognitionSnapshot,
  reduceImageRecognitionSnapshot,
  upsertImageRecognitionSnapshot,
  WORKBENCH_ATTACHMENT_RECOGNITION_CUSTOM_TYPE,
  WORKBENCH_ATTACHMENT_RECOGNITION_DATA_NAME,
  WORKBENCH_IMAGE_RECOGNITION_CUSTOM_TYPE,
  WORKBENCH_IMAGE_RECOGNITION_DATA_NAME,
  type AttachmentRecognitionSnapshot,
  type ImageRecognitionResult,
  type ImageRecognitionSnapshot,
} from "../src/state-machine";

const pending = {
  version: 1,
  operationId: "recognition-1",
  submissionId: "submission-1",
  rpcId: "session.prompt:1",
  revision: 0,
  status: "pending",
  method: "ocr",
  imageCount: 2,
  completedCount: 0,
  progress: 0,
  timestamps: { createdAt: 100, updatedAt: 100 },
} as const satisfies ImageRecognitionSnapshot;

const recognizedResults = [
  { imageId: "image-1", format: "markdown", text: "# Invoice" },
  { imageId: "image-2", format: "text", text: "Total: 42" },
] as const satisfies readonly ImageRecognitionResult[];

function running(
  revision: number,
  stage: (typeof IMAGE_RECOGNITION_STAGES)[number],
  overrides: Partial<ImageRecognitionSnapshot> = {},
): ImageRecognitionSnapshot {
  return {
    ...pending,
    revision,
    status: "running",
    stage,
    providerId: "paddle-local",
    progress: 0.25,
    timestamps: { createdAt: 100, updatedAt: 100 + revision },
    ...overrides,
  } as ImageRecognitionSnapshot;
}

function transitionErrorCode(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    assert.ok(error instanceof ImageRecognitionTransitionError);
    return error.code;
  }
}

test("exports stable protocol identifiers", () => {
  assert.equal(WORKBENCH_ATTACHMENT_RECOGNITION_CUSTOM_TYPE, "workbench.attachment-recognition.v1");
  assert.equal(WORKBENCH_ATTACHMENT_RECOGNITION_DATA_NAME, "workbench.attachment-recognition");
  assert.equal(WORKBENCH_IMAGE_RECOGNITION_CUSTOM_TYPE, "workbench.image-recognition.v1");
  assert.equal(WORKBENCH_IMAGE_RECOGNITION_DATA_NAME, "workbench.image-recognition");
});

test("job progress survives snapshot reduction and rejects malformed or unsafe metadata", () => {
  const job = {
    attachmentId: "pdf-1",
    status: "running",
    completedPages: 2,
    totalPages: 10,
    pollCount: 3,
  } as const;
  const snapshot = parseAttachmentRecognitionSnapshot(running(1, "polling", { jobs: [job] }));
  assert.ok(snapshot);
  assert.deepEqual(snapshot.jobs, [job]);
  assert.equal(reduceAttachmentRecognitionSnapshot(snapshot, structuredClone(snapshot)), snapshot);
  assert.throws(
    () =>
      reduceAttachmentRecognitionSnapshot(snapshot, {
        ...snapshot,
        jobs: [{ ...job, completedPages: 3 }],
      }),
    /revision/,
  );
  for (const jobs of [
    [{ ...job, completedPages: -1 }],
    [{ ...job, totalPages: 0 }],
    [{ ...job, completedPages: 11 }],
    [{ ...job, totalPages: Infinity }],
    [{ ...job, pollCount: 1.5 }],
    [{ ...job, status: "unexpected" }],
    [{ ...job, jobId: "secret" }],
    [job, job],
  ])
    assert.equal(parseAttachmentRecognitionSnapshot({ ...snapshot, jobs }), undefined);
});

test("round-trips stable one-based image and PDF references", () => {
  assert.equal(attachmentReferenceId({ kind: "image", sequence: 1 }), "image-1");
  assert.equal(attachmentReferenceId({ kind: "pdf", sequence: 2 }), "pdf-2");
  assert.deepEqual(parseAttachmentReferenceId("image-20"), { kind: "image", sequence: 20 });
  assert.deepEqual(parseAttachmentReferenceId("pdf-1"), { kind: "pdf", sequence: 1 });

  for (const invalid of ["attachment-1", "image-0", "image-21", "pdf-01", "PDF-1", null]) {
    assert.equal(parseAttachmentReferenceId(invalid), undefined);
  }
  assert.throws(() => attachmentReferenceId({ kind: "image", sequence: 0 }), RangeError);
});

test("parses and reduces the attachment-neutral protocol while normalizing legacy snapshots", () => {
  const attachmentPending = {
    version: 1,
    operationId: "attachment-recognition-1",
    submissionId: "attachment-submission-1",
    revision: 0,
    status: "pending",
    method: "ocr",
    attachmentCount: 2,
    completedCount: 0,
    progress: 0,
  } as const satisfies AttachmentRecognitionSnapshot;
  const running = {
    ...attachmentPending,
    revision: 1,
    status: "running",
    stage: "recognizing",
    completedCount: 1,
    progress: 0.5,
  } as const satisfies AttachmentRecognitionSnapshot;

  assert.deepEqual(parseAttachmentRecognitionSnapshot(attachmentPending), attachmentPending);
  assert.equal(isAttachmentRecognitionSnapshot(attachmentPending), true);
  assert.deepEqual(reduceAttachmentRecognitionSnapshot(attachmentPending, running), running);
  const { attachmentCount, ...legacyPending } = attachmentPending;
  assert.deepEqual(
    parseAttachmentRecognitionSnapshot({ ...legacyPending, imageCount: attachmentCount }),
    attachmentPending,
  );
  assert.equal(
    parseAttachmentRecognitionSnapshot({ ...attachmentPending, imageCount: 2 }),
    undefined,
  );
});

test("parses every supported running stage into a JSON-serializable v1 snapshot", () => {
  for (const [index, stage] of IMAGE_RECOGNITION_STAGES.entries()) {
    const snapshot = running(index + 1, stage);
    const parsed = parseImageRecognitionSnapshot(JSON.parse(JSON.stringify(snapshot)));
    assert.deepEqual(parsed, snapshot);
    assert.equal(isImageRecognitionSnapshot(snapshot), true);
    assert.equal(isTerminalImageRecognitionSnapshot(snapshot), false);
  }
});

test("parses all terminal states with their status-specific constraints", () => {
  const succeeded = {
    ...running(1, "normalizing"),
    revision: 2,
    status: "succeeded",
    stage: undefined,
    completedCount: 2,
    progress: 1,
    results: recognizedResults,
    timestamps: { createdAt: 100, updatedAt: 102, completedAt: 102 },
  };
  const failed = {
    ...running(1, "recognizing"),
    revision: 2,
    status: "failed",
    stage: undefined,
    errorCode: "provider-timeout",
    diagnostic: {
      phase: "result-download",
      reason: "download-failed",
      httpStatus: 302,
      providerCode: "10004",
      resultSource: "jsonl",
    },
    results: undefined,
    timestamps: { createdAt: 100, updatedAt: 102, completedAt: 102 },
  };
  const cancelled = {
    ...running(1, "polling"),
    revision: 2,
    status: "cancelled",
    stage: undefined,
    timestamps: { createdAt: 100, updatedAt: 102, completedAt: 102 },
  };
  const skipped = {
    ...running(1, "routing"),
    revision: 2,
    status: "skipped",
    stage: undefined,
    method: "native",
    providerId: undefined,
    timestamps: { createdAt: 100, updatedAt: 102, completedAt: 102 },
  };

  for (const snapshot of [succeeded, failed, cancelled, skipped]) {
    const parsed = parseImageRecognitionSnapshot(snapshot);
    assert.ok(parsed);
    assert.equal(isTerminalImageRecognitionSnapshot(parsed), true);
  }
  assert.deepEqual(parseImageRecognitionSnapshot(failed)?.diagnostic, failed.diagnostic);
});

test("accepts only bounded normalized results on a succeeded terminal snapshot", () => {
  const succeeded = {
    ...running(1, "normalizing"),
    revision: 2,
    status: "succeeded",
    stage: undefined,
    completedCount: 2,
    progress: 1,
    results: recognizedResults,
    timestamps: { createdAt: 100, updatedAt: 102, completedAt: 102 },
  } as const;

  assert.deepEqual(parseImageRecognitionSnapshot(succeeded)?.results, recognizedResults);
  assert.deepEqual(
    parseImageRecognitionSnapshot({
      ...succeeded,
      results: [{ ...recognizedResults[0], truncated: true }, recognizedResults[1]],
    })?.results,
    [{ ...recognizedResults[0], truncated: true }, recognizedResults[1]],
  );
  const parsed = parseImageRecognitionSnapshot(succeeded);
  assert.ok(parsed);
  assert.equal(reduceImageRecognitionSnapshot(parsed, structuredClone(succeeded)), parsed);
  assert.equal(
    transitionErrorCode(() =>
      reduceImageRecognitionSnapshot(parsed, {
        ...succeeded,
        results: [{ ...recognizedResults[0], text: "changed" }, recognizedResults[1]],
      }),
    ),
    "revision-conflict",
  );

  const invalidResults = [
    [{ imageId: "image-1", format: "text", text: "missing second image" }],
    [recognizedResults[0], { ...recognizedResults[1], imageId: "image-1" }],
    [recognizedResults[0], { ...recognizedResults[1], format: "html" }],
    [recognizedResults[0], { ...recognizedResults[1], truncated: false }],
    [recognizedResults[0], { ...recognizedResults[1], endpoint: "https://private.example" }],
    [
      {
        imageId: "image-1",
        format: "text",
        text: "x".repeat(MAX_IMAGE_RECOGNITION_RESULT_CHARACTERS),
      },
      { imageId: "image-2", format: "text", text: "x" },
    ],
  ];
  for (const results of invalidResults) {
    assert.equal(parseImageRecognitionSnapshot({ ...succeeded, results }), undefined);
  }
  assert.equal(
    parseImageRecognitionSnapshot({ ...pending, results: recognizedResults }),
    undefined,
  );
  assert.equal(
    parseImageRecognitionSnapshot({
      ...succeeded,
      status: "failed",
      errorCode: "provider-timeout",
      results: recognizedResults,
    }),
    undefined,
  );
});

test("accepts the legal pending to running stages to terminal lifecycle", () => {
  let current: ImageRecognitionSnapshot = pending;
  for (const [index, stage] of IMAGE_RECOGNITION_STAGES.entries()) {
    current = reduceImageRecognitionSnapshot(
      current,
      running(index + 1, stage, {
        completedCount: Math.min(index, pending.imageCount),
        progress: Math.min((index + 1) / 8, 0.9),
      }),
    );
  }

  const succeeded = {
    ...current,
    revision: current.revision + 1,
    status: "succeeded",
    stage: undefined,
    completedCount: pending.imageCount,
    progress: 1,
    timestamps: {
      createdAt: 100,
      updatedAt: 200,
      completedAt: 200,
    },
  };
  current = reduceImageRecognitionSnapshot(current, succeeded);
  assert.equal(current.status, "succeeded");
});

test("allows method and provider changes during a fallback", () => {
  const routed = reduceImageRecognitionSnapshot(pending, running(1, "recognizing"));
  const fallback = reduceImageRecognitionSnapshot(routed, {
    ...running(2, "fallback"),
    method: "multimodal",
    providerId: "vision-fallback",
  });

  assert.equal(fallback.status, "running");
  assert.equal(fallback.method, "multimodal");
  assert.equal(fallback.providerId, "vision-fallback");
});

test("treats exact duplicate revisions as idempotent and ignores older revisions", () => {
  const current = running(3, "recognizing");
  assert.equal(reduceImageRecognitionSnapshot(current, { ...current }), current);
  assert.equal(reduceImageRecognitionSnapshot(current, running(2, "polling")), current);
});

test("reconciles a terminal history snapshot when an intermediate running revision was omitted", () => {
  const succeeded = {
    ...running(1, "normalizing"),
    revision: 2,
    status: "succeeded",
    stage: undefined,
    completedCount: 2,
    progress: 1,
    timestamps: { createdAt: 100, updatedAt: 102, completedAt: 102 },
  } as const;

  assert.equal(
    transitionErrorCode(() => reduceImageRecognitionSnapshot(pending, succeeded)),
    "invalid-transition",
    "the live reducer remains strict",
  );
  const expected = parseImageRecognitionSnapshot(succeeded);
  assert.ok(expected);
  assert.deepEqual(reconcileImageRecognitionSnapshot(pending, succeeded), expected);
});

test("replay reconciliation requires a revision gap and never permits a reverse transition", () => {
  const adjacentTerminal = {
    ...pending,
    revision: 1,
    status: "cancelled",
    timestamps: { createdAt: 100, updatedAt: 101, completedAt: 101 },
  } as const;
  const newerPending = {
    ...pending,
    revision: 3,
    timestamps: { createdAt: 100, updatedAt: 103 },
  } as const;

  assert.equal(
    transitionErrorCode(() => reconcileImageRecognitionSnapshot(pending, adjacentTerminal)),
    "invalid-transition",
  );
  assert.equal(
    transitionErrorCode(() => reconcileImageRecognitionSnapshot(pending, newerPending)),
    "invalid-transition",
  );
  assert.equal(
    transitionErrorCode(() =>
      reconcileImageRecognitionSnapshot(running(1, "recognizing"), newerPending),
    ),
    "invalid-transition",
  );
});

test("replay reconciliation preserves reducer identity, revision, terminal, and monotonic rules", () => {
  const current = running(3, "recognizing", { completedCount: 1 });
  const terminal = {
    ...current,
    revision: 4,
    status: "failed",
    stage: undefined,
    errorCode: "provider-timeout",
    results: undefined,
    timestamps: { createdAt: 100, updatedAt: 104, completedAt: 104 },
  } as const;

  assert.equal(reconcileImageRecognitionSnapshot(current, running(2, "polling")), current);
  assert.equal(reconcileImageRecognitionSnapshot(current, { ...current }), current);
  assert.equal(
    transitionErrorCode(() =>
      reconcileImageRecognitionSnapshot(current, { ...current, stage: "normalizing" }),
    ),
    "revision-conflict",
  );
  assert.equal(
    transitionErrorCode(() =>
      reconcileImageRecognitionSnapshot(current, {
        ...running(4, "normalizing", { completedCount: 1 }),
        submissionId: "submission-2",
      }),
    ),
    "identity-mismatch",
  );
  assert.equal(
    transitionErrorCode(() =>
      reconcileImageRecognitionSnapshot(current, running(4, "normalizing", { completedCount: 0 })),
    ),
    "completed-count-regression",
  );
  assert.equal(
    transitionErrorCode(() =>
      reconcileImageRecognitionSnapshot(
        current,
        running(4, "normalizing", {
          completedCount: 1,
          timestamps: { createdAt: 100, updatedAt: 102 },
        }),
      ),
    ),
    "timestamp-regression",
  );
  assert.equal(
    transitionErrorCode(() =>
      reconcileImageRecognitionSnapshot(terminal, running(6, "fallback", { completedCount: 1 })),
    ),
    "terminal-state",
  );
});

test("rejects conflicting duplicate revisions", () => {
  const current = running(3, "recognizing");
  assert.equal(
    transitionErrorCode(() =>
      reduceImageRecognitionSnapshot(current, { ...current, stage: "normalizing" }),
    ),
    "revision-conflict",
  );
});

test("rejects illegal state transitions and newer revisions after a terminal state", () => {
  const failed = {
    ...running(1, "recognizing"),
    revision: 2,
    status: "failed",
    stage: undefined,
    errorCode: "provider-timeout",
    results: undefined,
    timestamps: { createdAt: 100, updatedAt: 102, completedAt: 102 },
  } as const;

  assert.equal(
    transitionErrorCode(() =>
      reduceImageRecognitionSnapshot(pending, {
        ...pending,
        revision: 1,
        status: "cancelled",
        timestamps: { createdAt: 100, updatedAt: 101, completedAt: 101 },
      }),
    ),
    "invalid-transition",
  );
  assert.equal(
    transitionErrorCode(() => reduceImageRecognitionSnapshot(running(1, "routing"), pending)),
    undefined,
    "an older pending snapshot is ignored before transition validation",
  );
  assert.equal(
    transitionErrorCode(() =>
      reduceImageRecognitionSnapshot(failed, running(3, "fallback", { completedCount: 1 })),
    ),
    "terminal-state",
  );
});

test("rejects operation identity changes, count regression, and timestamp regression", () => {
  const current = running(1, "recognizing", { completedCount: 1 });
  assert.equal(
    transitionErrorCode(() =>
      reduceImageRecognitionSnapshot(current, {
        ...running(2, "normalizing", { completedCount: 1 }),
        submissionId: "submission-2",
      }),
    ),
    "identity-mismatch",
  );
  assert.equal(
    transitionErrorCode(() =>
      reduceImageRecognitionSnapshot(current, running(2, "normalizing", { completedCount: 0 })),
    ),
    "completed-count-regression",
  );
  assert.equal(
    transitionErrorCode(() =>
      reduceImageRecognitionSnapshot(
        current,
        running(2, "normalizing", {
          completedCount: 1,
          timestamps: { createdAt: 100, updatedAt: 99 },
        }),
      ),
    ),
    "invalid-snapshot",
  );
  assert.equal(
    transitionErrorCode(() =>
      reduceImageRecognitionSnapshot(
        current,
        running(2, "normalizing", {
          completedCount: 1,
          timestamps: { createdAt: 100, updatedAt: 101 },
        }),
      ),
    ),
    undefined,
  );
});

test("strict parser rejects unknown, raw, oversized, non-finite, and inconsistent fields", () => {
  const invalidValues = [
    null,
    [],
    { ...pending, version: 2 },
    { ...pending, rawOcr: "secret text" },
    { ...pending, error: "provider stack" },
    { ...pending, base64: "aGVsbG8=" },
    { ...pending, operationId: "bad id with spaces" },
    { ...pending, rpcId: "x".repeat(257) },
    { ...pending, revision: -1 },
    { ...pending, revision: 0.5 },
    { ...pending, method: "tool" },
    { ...pending, imageCount: 0 },
    { ...pending, completedCount: 1 },
    { ...pending, progress: Number.NaN },
    { ...pending, progress: 1.1 },
    { ...pending, stage: "routing" },
    { ...pending, errorCode: "failure" },
    {
      ...running(1, "routing"),
      status: "failed",
      stage: undefined,
      errorCode: "provider-invalid-response",
      diagnostic: { phase: "result-download", reason: "raw response body", apiKey: "secret" },
      timestamps: { createdAt: 100, updatedAt: 101, completedAt: 101 },
    },
    { ...pending, timestamps: { createdAt: 100, updatedAt: 99 } },
    { ...running(1, "routing"), stage: "uploading" },
    { ...running(1, "routing"), errorCode: "failure" },
    {
      ...running(1, "routing"),
      status: "failed",
      stage: undefined,
      errorCode: "Raw provider failure with spaces",
      timestamps: { createdAt: 100, updatedAt: 101, completedAt: 101 },
    },
    {
      ...running(1, "normalizing"),
      status: "succeeded",
      stage: undefined,
      completedCount: 1,
      progress: 1,
      timestamps: { createdAt: 100, updatedAt: 101, completedAt: 101 },
    },
    {
      ...running(1, "normalizing"),
      status: "succeeded",
      stage: undefined,
      completedCount: 2,
      progress: 1,
      timestamps: { createdAt: 100, updatedAt: 101 },
    },
  ];

  for (const value of invalidValues) {
    assert.equal(parseImageRecognitionSnapshot(value), undefined, JSON.stringify(value));
    assert.equal(isImageRecognitionSnapshot(value), false);
  }
});

test("upsert inserts a replay baseline and reduces later or out-of-order snapshots immutably", () => {
  const terminalBaseline = {
    ...running(1, "normalizing"),
    revision: 2,
    status: "succeeded",
    stage: undefined,
    completedCount: 2,
    progress: 1,
    timestamps: { createdAt: 100, updatedAt: 102, completedAt: 102 },
  };
  const baseline = upsertImageRecognitionSnapshot([], terminalBaseline);
  assert.equal(baseline.length, 1);
  assert.equal(baseline[0]?.status, "succeeded");

  const active = upsertImageRecognitionSnapshot([], pending);
  const advanced = upsertImageRecognitionSnapshot(active, running(1, "routing"));
  const ignored = upsertImageRecognitionSnapshot(advanced, pending);
  const duplicate = upsertImageRecognitionSnapshot(advanced, { ...advanced[0] });

  assert.notEqual(advanced, active);
  assert.equal(advanced[0]?.status, "running");
  assert.equal(ignored, advanced);
  assert.equal(duplicate, advanced);
});
