import assert from "node:assert/strict";
import test from "node:test";
import type { WorkbenchWorkspaceGitDiff } from "@workbench/agent-runtime-contracts/runtime-capabilities";
import { readWorkspaceFileDiffResource } from "../src/file-diff-resource";

const request = {
  workspaceId: "workspace",
  scope: "last-turn" as const,
  revision: "turn-1",
  sessionId: "thread-1",
  path: "src/file.ts",
};
const page = (patch: string, extra = {}): WorkbenchWorkspaceGitDiff => ({
  repository: true,
  branches: [],
  files: [],
  patch,
  patchVersion: "version-1",
  ...extra,
});
const patch = "--- a/src/file.ts\n+++ b/src/file.ts\n@@ -1,3 +1,3 @@\n before\n-old\n+新\n after\n";

test("assembles all pages of the selected turn and preserves full-file context", async () => {
  const calls: unknown[] = [];
  const result = await readWorkspaceFileDiffResource(
    {
      readGitDiff: async (input) => {
        calls.push(input);
        return input.offset ? page(patch.slice(23)) : page(patch.slice(0, 23), { nextOffset: 23 });
      },
    },
    request,
    new AbortController().signal,
  );
  assert.equal(result.path, request.path);
  assert.equal(result.scheme, "workspace-file");
  assert.deepEqual(result.metadata?.lines, [
    { kind: "context", text: "before" },
    { kind: "removed", text: "old" },
    { kind: "added", text: "新" },
    { kind: "context", text: "after" },
  ]);
  assert.deepEqual(calls, [
    { ...request, fullContext: true, exportPatch: false, offset: 0, patchVersion: undefined },
    { ...request, fullContext: true, exportPatch: false, offset: 23, patchVersion: "version-1" },
  ]);
  assert.ok(String(result.metadata?.diffId).includes("turn-1"));
});

test("deleted and newly added files retain their complete diff", async () => {
  const deleted = await readWorkspaceFileDiffResource(
    {
      readGitDiff: async () => page("--- a/file\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-one\n-two\n"),
    },
    request,
    new AbortController().signal,
  );
  assert.equal(deleted.metadata?.snapshotOnly, true);
  assert.deepEqual(deleted.metadata?.lines, [
    { kind: "removed", text: "one" },
    { kind: "removed", text: "two" },
  ]);
  const added = await readWorkspaceFileDiffResource(
    {
      readGitDiff: async () => page("--- /dev/null\n+++ b/file\n@@ -0,0 +1,1 @@\n+new\n"),
    },
    request,
    new AbortController().signal,
  );
  assert.equal(added.metadata?.snapshotOnly, true);
  assert.deepEqual(added.metadata?.lines, [{ kind: "added", text: "new" }]);
});

test("rejects stale or broken pagination and partial or binary content", async () => {
  for (const next of [page("tail", { patchVersion: "changed" }), page("tail", { nextOffset: 2 })]) {
    await assert.rejects(
      readWorkspaceFileDiffResource(
        {
          readGitDiff: async (input) => (input.offset ? next : page("head", { nextOffset: 4 })),
        },
        request,
        new AbortController().signal,
      ),
    );
  }
  for (const value of [
    page("@@ -45,1 +45,1 @@\n-old\n+new\n"),
    page("GIT binary patch\nliteral 12\n"),
    page("", { unrecorded: true }),
    { repository: false } as const,
  ]) {
    await assert.rejects(
      readWorkspaceFileDiffResource(
        { readGitDiff: async () => value },
        request,
        new AbortController().signal,
      ),
    );
  }
});

test("cancellation stops continuation and UTF-8 bytes bound full-file buffering", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    readWorkspaceFileDiffResource(
      {
        readGitDiff: async () => {
          calls++;
          controller.abort();
          return page("head", { nextOffset: 4 });
        },
      },
      request,
      controller.signal,
    ),
    { name: "AbortError" },
  );
  assert.equal(calls, 1);
  await assert.rejects(
    readWorkspaceFileDiffResource(
      {
        readGitDiff: async () => page("界".repeat(Math.ceil((16 * 1024 * 1024) / 3) + 1)),
      },
      request,
      new AbortController().signal,
    ),
    /16 MiB/,
  );
});
