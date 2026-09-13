import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkbenchParallelToolPresentationMetadata,
  createWorkbenchReasoningPresentationMetadata,
  readWorkbenchParallelToolPresentationMetadata,
  readWorkbenchReasoningPresentationMetadata,
} from "../src/conversation/presentation-metadata";

test("round-trips generic reasoning presentation metadata", () => {
  const metadata = createWorkbenchReasoningPresentationMetadata({
    startedAt: 1_000,
    durationMs: 2_500,
  });

  assert.deepEqual(metadata, {
    workbench: { reasoningTiming: { startedAt: 1_000, durationMs: 2_500 } },
  });
  assert.deepEqual(readWorkbenchReasoningPresentationMetadata(metadata), {
    startedAt: 1_000,
    durationMs: 2_500,
  });
});

test("round-trips generic parallel tool presentation metadata", () => {
  const metadata = createWorkbenchParallelToolPresentationMetadata("batch-1", 3);

  assert.deepEqual(metadata, {
    workbench: { parallelToolBatch: { id: "batch-1", size: 3 } },
  });
  assert.deepEqual(readWorkbenchParallelToolPresentationMetadata(metadata), {
    batchId: "batch-1",
    batchSize: 3,
  });
});

test("rejects malformed presentation metadata", () => {
  assert.equal(createWorkbenchReasoningPresentationMetadata({ durationMs: -1 }), undefined);
  assert.equal(createWorkbenchParallelToolPresentationMetadata("", 2), undefined);
  assert.equal(
    readWorkbenchParallelToolPresentationMetadata({
      workbench: { parallelToolBatch: { id: "batch", size: 1 } },
    }),
    undefined,
  );
});
