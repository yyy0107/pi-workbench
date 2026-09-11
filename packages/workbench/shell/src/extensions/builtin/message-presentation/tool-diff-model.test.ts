import assert from "node:assert/strict";
import test from "node:test";

import { toolDiffModel } from "./tool-diff-model";

test("builds an edit diff from replacement blocks", () => {
  assert.deepEqual(
    toolDiffModel({
      toolName: "edit",
      toolCallId: "edit-1",
      args: {
        path: "/workspace/thread.tsx",
        edits: [
          {
            oldText: "const x = 1\nconst y = 2\n",
            newText: "const x = 2\nconst y = 3\nconst z = 4\n",
          },
        ],
      },
    }),
    {
      toolCallId: "edit-1",
      path: "/workspace/thread.tsx",
      filename: "thread.tsx",
      additions: 3,
      deletions: 2,
      lines: [
        { kind: "removed", text: "const x = 1" },
        { kind: "removed", text: "const y = 2" },
        { kind: "added", text: "const x = 2" },
        { kind: "added", text: "const y = 3" },
        { kind: "added", text: "const z = 4" },
      ],
      hunks: [
        {
          id: "edit-1:args:0",
          range: "@@ -1,2 +1,3 @@",
          decision: "pending",
          lines: [
            { kind: "removed", text: "const x = 1" },
            { kind: "removed", text: "const y = 2" },
            { kind: "added", text: "const x = 2" },
            { kind: "added", text: "const y = 3" },
            { kind: "added", text: "const z = 4" },
          ],
        },
      ],
    },
  );
});

test("builds a new-file diff from write content", () => {
  assert.deepEqual(
    toolDiffModel({
      toolName: "write",
      toolCallId: "write-1",
      args: { file_path: "src/new.ts", content: "one\n\ntwo\n" },
    }),
    {
      toolCallId: "write-1",
      path: "src/new.ts",
      filename: "new.ts",
      additions: 3,
      deletions: 0,
      lines: [
        { kind: "added", text: "one" },
        { kind: "added", text: "" },
        { kind: "added", text: "two" },
      ],
      hunks: [
        {
          id: "write-1:args:0",
          range: "@@ -0,0 +1,3 @@",
          decision: "pending",
          lines: [
            { kind: "added", text: "one" },
            { kind: "added", text: "" },
            { kind: "added", text: "two" },
          ],
        },
      ],
    },
  );
});

test("splits a completed unified patch into review hunks with one context line", () => {
  const model = toolDiffModel({
    toolName: "edit",
    toolCallId: "edit-patch",
    args: { path: "/workspace/thread.tsx", edits: [] },
    result: {
      details: {
        patch: [
          "--- a/thread.tsx",
          "+++ b/thread.tsx",
          "@@ -10,8 +10,8 @@",
          " before",
          "-old first",
          "+new first",
          " shared one",
          " shared two",
          " shared three",
          "-old second",
          "+new second",
          " after",
        ].join("\n"),
      },
    },
  });

  assert.deepEqual(model?.hunks, [
    {
      id: "edit-patch:patch:0:0",
      range: "@@ -10,3 +10,3 @@",
      decision: "pending",
      lines: [
        { kind: "context", text: "before" },
        { kind: "removed", text: "old first" },
        { kind: "added", text: "new first" },
        { kind: "context", text: "shared one" },
      ],
      hiddenContextBefore: 0,
      hiddenContextAfter: 0,
    },
    {
      id: "edit-patch:patch:0:1",
      range: "@@ -14,3 +14,3 @@",
      decision: "pending",
      lines: [
        { kind: "context", text: "shared three" },
        { kind: "removed", text: "old second" },
        { kind: "added", text: "new second" },
        { kind: "context", text: "after" },
      ],
      hiddenContextBefore: 1,
      hiddenContextAfter: 0,
    },
  ]);
  assert.equal(model?.additions, 2);
  assert.equal(model?.deletions, 2);
});

test("ignores unsupported tools and mutation calls without a path", () => {
  assert.equal(toolDiffModel({ toolName: "read", toolCallId: "read-1", args: {} }), undefined);
  assert.equal(toolDiffModel({ toolName: "edit", toolCallId: "edit-2", args: {} }), undefined);
});
