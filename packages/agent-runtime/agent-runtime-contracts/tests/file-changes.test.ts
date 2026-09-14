import assert from "node:assert/strict";
import test from "node:test";

import { parseWorkbenchFileChangeSet } from "../src/file-changes";

const valid = {
  version: 1,
  id: "change-1",
  threadId: "thread-1",
  createdAt: 42,
  files: [
    {
      path: "src/example.ts",
      previousPath: "src/old-example.ts",
      kind: "renamed",
      additions: 2,
      deletions: 1,
    },
  ],
  totalFiles: 1,
  additions: 2,
  deletions: 1,
  undoAvailable: true,
} as const;

test("parses a bounded runtime-neutral FileChangeSet", () => {
  assert.deepEqual(parseWorkbenchFileChangeSet(valid), valid);
});

test("rejects unsafe paths and inconsistent persisted summaries", () => {
  for (const path of ["../outside", "/absolute", "C:\\absolute", "src//empty.ts"]) {
    assert.equal(
      parseWorkbenchFileChangeSet({
        ...valid,
        files: [{ ...valid.files[0], path }],
      }),
      undefined,
    );
  }
  assert.equal(parseWorkbenchFileChangeSet({ ...valid, totalFiles: 0 }), undefined);
  assert.equal(
    parseWorkbenchFileChangeSet({
      ...valid,
      files: [{ path: "src/copied.ts", kind: "copied" }],
    }),
    undefined,
  );
});
