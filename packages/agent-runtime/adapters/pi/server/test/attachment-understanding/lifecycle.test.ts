import assert from "node:assert/strict";
import test from "node:test";

import type { AttachmentRecognitionSnapshot } from "@workbench/attachment-understanding-contracts/state-machine";

import { AttachmentRecognitionLifecycle } from "../../src/attachment-understanding/lifecycle";

test("publishes a monotonic lifecycle even if the wall clock moves backwards", async () => {
  const clock = [1_000, 900, 800];
  const snapshots: AttachmentRecognitionSnapshot[] = [];
  const lifecycle = new AttachmentRecognitionLifecycle({
    operationId: "operation-1",
    submissionId: "submission-1",
    rpcId: "rpc-1",
    method: "ocr",
    providerId: "glm-ocr",
    attachmentCount: 1,
    now: () => clock.shift() ?? 700,
    publish: (snapshot) => {
      snapshots.push(snapshot);
    },
  });

  await lifecycle.pending();
  await lifecycle.running("recognizing");
  await lifecycle.succeeded({
    results: [{ attachmentId: "image-1", format: "markdown", text: "# Invoice\nTotal: 42" }],
  });

  assert.deepEqual(
    snapshots.map(({ revision, status }) => ({ revision, status })),
    [
      { revision: 0, status: "pending" },
      { revision: 1, status: "running" },
      { revision: 2, status: "succeeded" },
    ],
  );
  assert.deepEqual(
    snapshots.map((snapshot) => snapshot.timestamps?.updatedAt),
    [1_000, 1_000, 1_000],
  );
  assert.equal(snapshots.at(-1)?.timestamps?.completedAt, 1_000);
  assert.deepEqual(snapshots.at(-1)?.results, [
    { attachmentId: "image-1", format: "markdown", text: "# Invoice\nTotal: 42" },
  ]);
  assert.equal(JSON.stringify(snapshots).includes("credential"), false);

  await assert.rejects(() => lifecycle.running("fallback"), {
    name: "ImageRecognitionTransitionError",
    code: "terminal-state",
  });
});

test("publishes only bounded sanitized failure diagnostics", async () => {
  const snapshots: AttachmentRecognitionSnapshot[] = [];
  const lifecycle = new AttachmentRecognitionLifecycle({
    operationId: "operation-failed",
    submissionId: "submission-failed",
    method: "ocr",
    providerId: "paddleocr",
    attachmentCount: 1,
    publish: (snapshot) => {
      snapshots.push(snapshot);
    },
  });

  await lifecycle.pending();
  await lifecycle.running("polling");
  await lifecycle.failed("provider-invalid-response", {
    phase: "result-download",
    reason: "download-failed",
    httpStatus: 302,
    resultSource: "jsonl",
  });

  assert.deepEqual(snapshots.at(-1)?.diagnostic, {
    phase: "result-download",
    reason: "download-failed",
    httpStatus: 302,
    resultSource: "jsonl",
  });
});
