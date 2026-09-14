import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import {
  GitReviewSnapshotConflictError,
  GitReviewSnapshotIsolationError,
  GitReviewSnapshots,
  restoreGitReviewSnapshot,
} from "../src/git-review-snapshots";
import { createWorkspaceFileChangeService } from "../src/file-changes";

async function fixture(t: TestContext, name: string) {
  const root = await mkdtemp(path.join(tmpdir(), `workbench-${name}-`));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "workspace");
  await mkdir(cwd);
  const snapshots = new GitReviewSnapshots(path.join(root, "private"));
  return { cwd, snapshots };
}

test("computes FileChangeSet from before/after snapshots and supports undo and redo", async (t) => {
  const { cwd, snapshots } = await fixture(t, "file-change-set");
  await writeFile(path.join(cwd, "changed.txt"), "old\n");
  await writeFile(path.join(cwd, "deleted.txt"), "removed\n");
  await writeFile(path.join(cwd, "renamed-from.txt"), "same content\n".repeat(20));

  const capture = await snapshots.begin(cwd);
  await writeFile(path.join(cwd, "changed.txt"), "new\nmore\n");
  await writeFile(path.join(cwd, "added.txt"), "created\n");
  await rm(path.join(cwd, "deleted.txt"));
  await rename(path.join(cwd, "renamed-from.txt"), path.join(cwd, "renamed-to.txt"));
  const snapshot = await capture.complete({ id: "change-1", threadId: "thread-1", timestamp: 42 });

  assert.deepEqual(snapshot.changeSet, {
    version: 1,
    id: "change-1",
    threadId: "thread-1",
    createdAt: 42,
    files: [
      { path: "added.txt", kind: "added", additions: 1, deletions: 0 },
      { path: "changed.txt", kind: "modified", additions: 2, deletions: 1 },
      { path: "deleted.txt", kind: "deleted", additions: 0, deletions: 1 },
      {
        path: "renamed-to.txt",
        previousPath: "renamed-from.txt",
        kind: "renamed",
        additions: 0,
        deletions: 0,
      },
    ],
    totalFiles: 4,
    additions: 3,
    deletions: 2,
    undoAvailable: true,
  });

  const gitDir = path.join(await snapshots.directory(cwd), "objects.git");
  await restoreGitReviewSnapshot(cwd, gitDir, {
    expected: snapshot.after!,
    target: snapshot.before!,
  });
  assert.equal(await readFile(path.join(cwd, "changed.txt"), "utf8"), "old\n");
  assert.equal(await readFile(path.join(cwd, "deleted.txt"), "utf8"), "removed\n");
  assert.equal(
    await readFile(path.join(cwd, "renamed-from.txt"), "utf8"),
    "same content\n".repeat(20),
  );
  await assert.rejects(readFile(path.join(cwd, "added.txt")), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(cwd, "renamed-to.txt")), { code: "ENOENT" });

  await restoreGitReviewSnapshot(cwd, gitDir, {
    expected: snapshot.before!,
    target: snapshot.after!,
  });
  assert.equal(await readFile(path.join(cwd, "changed.txt"), "utf8"), "new\nmore\n");
  assert.equal(await readFile(path.join(cwd, "added.txt"), "utf8"), "created\n");
  assert.equal(
    await readFile(path.join(cwd, "renamed-to.txt"), "utf8"),
    "same content\n".repeat(20),
  );
  await assert.rejects(readFile(path.join(cwd, "deleted.txt")), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(cwd, "renamed-from.txt")), { code: "ENOENT" });
});

test("three-way undo preserves non-overlapping newer work", async (t) => {
  const { cwd, snapshots } = await fixture(t, "file-change-merge");
  const file = path.join(cwd, "lines.txt");
  const before = "one\ntwo\nthree\nfour\nfive\n";
  const after = "ONE\ntwo\nthree\nfour\nfive\n";
  await writeFile(file, before);
  const capture = await snapshots.begin(cwd);
  await writeFile(file, after);
  const snapshot = await capture.complete({ id: "change-merge", threadId: "thread-1" });
  await writeFile(file, "ONE\ntwo\nthree\nfour\nFIVE\n");

  const result = await restoreGitReviewSnapshot(
    cwd,
    path.join(await snapshots.directory(cwd), "objects.git"),
    { expected: snapshot.after!, target: snapshot.before! },
  );

  assert.deepEqual(result, { merged: true });
  assert.equal(await readFile(file, "utf8"), "one\ntwo\nthree\nfour\nFIVE\n");
});

test("overlapping newer work fails without changing the workspace", async (t) => {
  const { cwd, snapshots } = await fixture(t, "file-change-conflict");
  const file = path.join(cwd, "conflict.txt");
  await writeFile(file, "before\ncontext\n");
  const capture = await snapshots.begin(cwd);
  await writeFile(file, "agent\ncontext\n");
  const snapshot = await capture.complete({ id: "change-conflict", threadId: "thread-1" });
  await writeFile(file, "user\ncontext\n");

  await assert.rejects(
    restoreGitReviewSnapshot(cwd, path.join(await snapshots.directory(cwd), "objects.git"), {
      expected: snapshot.after!,
      target: snapshot.before!,
    }),
    GitReviewSnapshotConflictError,
  );
  assert.equal(await readFile(file, "utf8"), "user\ncontext\n");
});

test("requires concurrent tasks to use distinct worktrees or overlays", async (t) => {
  const { cwd, snapshots } = await fixture(t, "file-change-isolation");
  const first = await snapshots.begin(cwd);
  await assert.rejects(snapshots.begin(cwd), GitReviewSnapshotIsolationError);
  await assert.rejects(
    restoreGitReviewSnapshot(cwd, path.join(await snapshots.directory(cwd), "objects.git"), {
      expected: "a".repeat(40),
      target: "b".repeat(40),
    }),
    GitReviewSnapshotIsolationError,
  );
  first.dispose();
  const next = await snapshots.begin(cwd);
  next.dispose();
});

test("workspace service resolves a task change set and serializes the mutation", async (t) => {
  const { cwd, snapshots } = await fixture(t, "file-change-service");
  const file = path.join(cwd, "service.txt");
  await writeFile(file, "before\n");
  const capture = await snapshots.begin(cwd);
  await writeFile(file, "after\n");
  const snapshot = await capture.complete({ id: "change-service", threadId: "thread-service" });
  let mutations = 0;
  const service = createWorkspaceFileChangeService({
    resolveWorkspaceRoot: async (workspaceId) => (workspaceId === "workspace" ? cwd : undefined),
    resolveSnapshots: async () => ({
      gitDir: path.join(await snapshots.directory(cwd), "objects.git"),
      snapshots: [snapshot],
    }),
    mutateWorkspace: async (_rootPath, operation) => {
      mutations += 1;
      return (await operation()).value;
    },
  });

  assert.deepEqual(
    await service.undo(
      { workspaceId: "workspace", threadId: "thread-service", changeSetId: "change-service" },
      new AbortController().signal,
    ),
    { applied: true, direction: "undo", merged: false },
  );
  assert.equal(mutations, 1);
  assert.equal(await readFile(file, "utf8"), "before\n");
  await assert.rejects(
    service.undo(
      { workspaceId: "workspace", threadId: "another-thread", changeSetId: "change-service" },
      new AbortController().signal,
    ),
    { code: "file-change-set-not-found" },
  );
});
