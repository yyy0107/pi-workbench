import assert from "node:assert/strict";
import test from "node:test";

import type { ImageRecognitionSnapshot } from "../../../image-understanding/state-machine";

import { ImageRecognitionLifecycle } from "./lifecycle";

test("publishes a monotonic lifecycle even if the wall clock moves backwards", async () => {
  const clock = [1_000, 900, 800];
  const snapshots: ImageRecognitionSnapshot[] = [];
  const lifecycle = new ImageRecognitionLifecycle({
    operationId: "operation-1",
    submissionId: "submission-1",
    rpcId: "rpc-1",
    method: "ocr",
    providerId: "glm-ocr",
    imageCount: 1,
    now: () => clock.shift() ?? 700,
    publish: (snapshot) => {
      snapshots.push(snapshot);
    },
  });

  await lifecycle.pending();
  await lifecycle.running("recognizing");
  await lifecycle.succeeded();

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
  assert.equal(JSON.stringify(snapshots).includes("credential"), false);

  await assert.rejects(() => lifecycle.running("fallback"), {
    name: "ImageRecognitionTransitionError",
    code: "terminal-state",
  });
});
