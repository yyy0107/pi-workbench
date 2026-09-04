import assert from "node:assert/strict";
import test from "node:test";

import { MemoryFileDiffService, parseFileDiffMetadata } from "./file-diff-service";

test("parses diff metadata owned by the workspace-file scheme", () => {
  assert.deepEqual(
    parseFileDiffMetadata({
      viewMode: "diff",
      diffId: "tool-1",
      lines: [
        { kind: "removed", text: "const value = 1;" },
        { kind: "added", text: "const value = 2;" },
      ],
    }),
    {
      id: "tool-1",
      lines: [
        { kind: "removed", text: "const value = 1;" },
        { kind: "added", text: "const value = 2;" },
      ],
    },
  );
  assert.equal(parseFileDiffMetadata({ viewMode: "source" }), undefined);
  assert.equal(
    parseFileDiffMetadata({
      viewMode: "diff",
      diffId: "tool-1",
      lines: [{ kind: "changed", text: "invalid" }],
    }),
    undefined,
  );
});

test("stores diff counts and advances the render cycle on refresh", () => {
  const service = new MemoryFileDiffService();
  const descriptor = {
    id: "tool-1",
    lines: [
      { kind: "context" as const, text: "before" },
      { kind: "removed" as const, text: "old" },
      { kind: "added" as const, text: "new" },
      { kind: "added" as const, text: "after" },
    ],
  };

  const first = service.upsert("src/file.ts", descriptor);
  const second = service.upsert("src/file.ts", descriptor);

  assert.equal(first.additions, 2);
  assert.equal(first.deletions, 1);
  assert.equal(second.cycle, first.cycle + 1);
  assert.equal(service.get("tool-1"), second);
});
