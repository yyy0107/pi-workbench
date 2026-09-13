import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import type { WorkbenchWorkspaceGitDiffRequest } from "@workbench/agent-runtime-contracts/runtime-capabilities";
import { createWorkspaceGitService, WorkspaceGitServiceError } from "../src/git";

const exec = promisify(execFile);

test("reads real Git comparison scopes, safe paths, binary files and complete paged patches", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args: string[]) => exec("git", args, { cwd: root });
  await git("init", "--initial-branch=main");
  await git("config", "user.name", "Review Test");
  await git("config", "user.email", "review@example.invalid");
  await writeFile(path.join(root, "changed.ts"), "const value = 1;\n");
  await writeFile(path.join(root, "deleted.txt"), "delete me\n");
  await writeFile(path.join(root, "original.txt"), "rename me\n");
  await git("add", ".");
  await git("commit", "-m", "base");
  const service = createWorkspaceGitService({
    resolveWorkspaceRoot: async (id) => (id === "workspace" ? root : undefined),
    mutateWorkspace: async (_root, operation) => (await operation()).value,
  });
  const read = async (request: Omit<WorkbenchWorkspaceGitDiffRequest, "workspaceId">) => {
    const result = await service.diff(
      { workspaceId: "workspace", ...request },
      new AbortController().signal,
    );
    assert.equal(result.repository, true);
    if (!result.repository) throw new Error("Expected repository");
    return result;
  };

  // Branch comparisons exclude both target-only commits and uncommitted working tree changes.
  await git("switch", "-c", "feature");
  await writeFile(path.join(root, "feature.txt"), "feature\n");
  await git("add", ".");
  await git("commit", "-m", "feature");
  await git("switch", "main");
  await writeFile(path.join(root, "target-only.txt"), "target\n");
  await git("add", ".");
  await git("commit", "-m", "target-only");
  await git("switch", "feature");
  await writeFile(path.join(root, "changed.ts"), "const value = 2;\n");
  await git("update-ref", "refs/remotes/origin/main", "main");
  const branch = await read({ scope: "branch", revision: "main" });
  assert.ok(branch.branches.includes("origin/main"));
  assert.deepEqual((await read({ scope: "branch", revision: "origin/main" })).files, branch.files);
  assert.equal(branch.branch, "feature");
  assert.deepEqual(
    branch.files.map((file) => file.path),
    ["feature.txt"],
  );
  await assert.rejects(read({ scope: "branch", revision: "--output=/tmp/injected" }), {
    code: "git-diff-invalid",
  });
  await assert.rejects(read({ scope: "unstaged", path: "../secret" }), {
    code: "git-diff-invalid",
  });

  await rename(path.join(root, "original.txt"), path.join(root, "renamed.txt"));
  await rm(path.join(root, "deleted.txt"));
  await writeFile(path.join(root, "binary.bin"), Buffer.from([0, 255, 1]));
  const oddPath = "雪\t[abc]\n.txt";
  await writeFile(path.join(root, oddPath), "第一行\n第二行\n");
  await symlink("/outside-workspace-secret", path.join(root, "link"));
  let unstaged = await read({ scope: "unstaged" });
  assert.deepEqual(
    unstaged.files.find((file) => file.path === "changed.ts"),
    {
      path: "changed.ts",
      kind: "modified",
      additions: 1,
      deletions: 1,
    },
  );
  assert.equal(unstaged.files.find((file) => file.path === "binary.bin")?.binary, true);
  assert.equal(unstaged.files.find((file) => file.path === oddPath)?.additions, 2);
  assert.equal(unstaged.files.find((file) => file.path === "link")?.additions, 1);
  const oddPatch = await read({ scope: "unstaged", path: oddPath });
  assert.match(oddPatch.patch!, /\+第一行\n\+第二行/);
  assert.deepEqual((await read({ scope: "staged" })).files, []);

  await git("add", "--all");
  const staged = await read({ scope: "staged" });
  const renamed = staged.files.find((file) => file.path === "renamed.txt");
  assert.equal(renamed?.kind, "renamed");
  assert.equal(renamed?.previousPath, "original.txt");
  assert.equal(staged.files.find((file) => file.path === "deleted.txt")?.deletions, 1);
  assert.match(
    (await read({ scope: "staged", path: "renamed.txt" })).patch!,
    /rename from original.txt/,
  );
  assert.deepEqual((await read({ scope: "unstaged" })).files, []);
  await writeFile(path.join(root, "changed.ts"), "const value = 3;\n");
  const stagedPatch = await read({ scope: "staged", path: "changed.ts" });
  const workingPatch = await read({ scope: "unstaged", path: "changed.ts" });
  assert.match(stagedPatch.patch!, /-const value = 1;\n\+const value = 2;/);
  assert.match(workingPatch.patch!, /-const value = 2;\n\+const value = 3;/);
  assert.match(
    (await read({ scope: "uncommitted", path: "changed.ts" })).patch!,
    /-const value = 1;\n\+const value = 3;/,
  );

  // Both many lines and one huge multibyte line must be retrievable without broken Unicode.
  const large = "雪🙂".repeat(25_000) + "\n" + "line\n".repeat(3_000);
  await writeFile(path.join(root, "large.txt"), large);
  let page = await read({ scope: "unstaged", path: "large.txt" });
  const firstPage = page;
  let patch = page.patch!;
  assert.ok(page.nextOffset);
  while (page.nextOffset !== undefined) {
    assert.ok(Buffer.byteLength(page.patch!) <= 4 * 32_768);
    assert.ok(!page.patch!.includes("\uFFFD"));
    page = await read({
      scope: "unstaged",
      path: "large.txt",
      offset: page.nextOffset,
      patchVersion: page.patchVersion,
    });
    patch += page.patch;
  }
  assert.ok(patch.includes("+" + large.trimEnd().replaceAll("\n", "\n+")));
  await writeFile(path.join(root, "large.txt"), "changed while paging\n");
  await assert.rejects(
    read({
      scope: "unstaged",
      path: "large.txt",
      offset: firstPage.nextOffset,
      patchVersion: firstPage.patchVersion,
    }),
    { code: "git-diff-stale" },
  );

  await mkdir(path.join(root, "many"));
  for (let index = 0; index < 205; index++)
    await writeFile(path.join(root, "many", String(index)), "");
  unstaged = await read({ scope: "unstaged" });
  assert.equal(unstaged.files.length, 200);
  assert.equal(unstaged.nextOffset, 200);
  const rest = await read({ scope: "unstaged", offset: unstaged.nextOffset });
  assert.equal(rest.nextOffset, undefined);
  assert.equal(new Set([...unstaged.files, ...rest.files].map((file) => file.path)).size, 207);

  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    service.diff({ workspaceId: "workspace", scope: "unstaged" }, aborted.signal),
    { name: "AbortError" },
  );
  await assert.rejects(
    service.diff({ workspaceId: "missing", scope: "unstaged" }, new AbortController().signal),
    (error: unknown) =>
      error instanceof WorkspaceGitServiceError && error.code === "workspace-not-found",
  );
});

test("reports non-repositories and supports staged files before the first commit", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-review-empty-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = createWorkspaceGitService({
    resolveWorkspaceRoot: async () => root,
    mutateWorkspace: async (_root, operation) => (await operation()).value,
  });
  const read = () =>
    service.diff({ workspaceId: "workspace", scope: "staged" }, new AbortController().signal);
  assert.deepEqual(await read(), { repository: false });
  await exec("git", ["init", "--initial-branch=main"], { cwd: root });
  await writeFile(path.join(root, "first.txt"), "first\n");
  await exec("git", ["add", "."], { cwd: root });
  const diff = await read();
  assert.ok(diff.repository);
  if (diff.repository)
    assert.deepEqual(diff.files, [
      { path: "first.txt", kind: "added", additions: 1, deletions: 0 },
    ]);
});

test("commit ranges and durable Agent snapshots preserve the user's Git state", async (t) => {
  const { GitReviewSnapshots } = await import("../src/git");
  const { readFile, stat } = await import("node:fs/promises");
  const root = await mkdtemp(path.join(tmpdir(), "workbench-review-scopes-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "project");
  await mkdir(cwd);
  const git = async (...args: string[]) => (await exec("git", args, { cwd })).stdout.trim();
  await git("init", "--initial-branch=main");
  await git("config", "user.name", "Review Test");
  await git("config", "user.email", "review@example.invalid");
  await writeFile(path.join(cwd, "file.txt"), "base\n");
  await writeFile(path.join(cwd, ".gitignore"), "ignored*\n");
  await writeFile(path.join(cwd, "ignored-tracked"), "tracked\n");
  await git("add", ".");
  await git("add", "--force", "ignored-tracked");
  await git("commit", "-m", "first");
  const first = await git("rev-parse", "HEAD");
  await writeFile(path.join(cwd, "file.txt"), "second\n");
  await git("commit", "-am", "second");
  const second = await git("rev-parse", "HEAD");
  await writeFile(path.join(cwd, "new.txt"), "third\n");
  await git("add", ".");
  await git("commit", "-m", "third");
  const third = await git("rev-parse", "HEAD");
  const snapshots = new GitReviewSnapshots(path.join(root, "private"));
  const turns: import("../src/git").GitReviewSnapshot[] = [];
  const service = createWorkspaceGitService({
    resolveWorkspaceRoot: async () => cwd,
    mutateWorkspace: async (_root, operation) => (await operation()).value,
    resolveReviewSnapshots: async (_cwd, id) => ({
      gitDir: path.join(await snapshots.directory(cwd), "objects.git"),
      snapshots: id === "session" ? turns : [],
    }),
  });
  const read = async (input: Omit<WorkbenchWorkspaceGitDiffRequest, "workspaceId">) => {
    const result = await service.diff(
      { workspaceId: "workspace", ...input },
      new AbortController().signal,
    );
    assert.ok(result.repository);
    return result;
  };
  assert.deepEqual(
    (await read({ scope: "commit", revision: second })).files.map((file) => file.path),
    ["file.txt"],
  );
  assert.equal((await read({ scope: "commit", revision: first })).files.length, 3);
  assert.deepEqual(
    (await read({ scope: "range", baseRevision: second, revision: third })).files.map(
      (file) => file.path,
    ),
    ["file.txt", "new.txt"],
  );
  await assert.rejects(read({ scope: "range", baseRevision: third, revision: first }));
  await assert.rejects(read({ scope: "commit", revision: "--output=/tmp/review-injection" }), {
    code: "git-diff-invalid",
  });
  assert.equal((await read({ scope: "session", sessionId: "missing" })).unrecorded, true);
  await writeFile(path.join(cwd, "file.txt"), "already staged\n");
  await git("add", "file.txt");
  const index = await readFile(path.join(cwd, ".git/index"));
  const refs = await git("show-ref");
  const before = await snapshots.capture(cwd);
  await writeFile(path.join(cwd, "file.txt"), "agent result\n");
  await writeFile(path.join(cwd, "ignored-output"), "do not record\n");
  await writeFile(path.join(cwd, "ignored-tracked"), "updated tracked\n");
  await writeFile(path.join(cwd, "雪\n[1].txt"), "created by bash\n");
  await rm(path.join(cwd, "new.txt"));
  const after = await snapshots.capture(cwd);
  turns.push({ id: "turn-1", timestamp: 1, before, after });
  assert.deepEqual(await readFile(path.join(cwd, ".git/index")), index);
  assert.equal(await git("show-ref"), refs);
  assert.equal((await stat(await snapshots.directory(cwd))).mode & 0o777, 0o700);
  let review = await read({ scope: "last-turn", sessionId: "session" });
  assert.deepEqual(
    review.files.map((file) => file.path),
    ["file.txt", "ignored-tracked", "new.txt", "雪\n[1].txt"],
  );
  assert.match(
    (await read({ scope: "last-turn", sessionId: "session", path: "file.txt" })).patch!,
    /-already staged\n\+agent result/,
  );
  const before2 = await snapshots.capture(cwd);
  await writeFile(path.join(cwd, "file.txt"), "next result\n");
  turns.push({ id: "turn-2", timestamp: 2, before: before2, after: await snapshots.capture(cwd) });
  assert.match(
    (await read({ scope: "last-turn", sessionId: "session", path: "file.txt" })).patch!,
    /-agent result\n\+next result/,
  );
  assert.match(
    (await read({ scope: "last-turn", sessionId: "session", revision: "turn-1", path: "file.txt" }))
      .patch!,
    /\+agent result/,
  );
  assert.match(
    (await read({ scope: "session", sessionId: "session", path: "file.txt" })).patch!,
    /-already staged\n\+next result/,
  );
  assert.equal(
    await new GitReviewSnapshots(path.join(root, "private")).capture(cwd),
    turns[1].after,
  );
});

test("session snapshots also review workspaces without a Git repository", async (t) => {
  const { GitReviewSnapshots } = await import("../src/git");
  const root = await mkdtemp(path.join(tmpdir(), "workbench-review-plain-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "project");
  await mkdir(cwd);
  const store = new GitReviewSnapshots(path.join(cwd, ".review-private"));
  const before = await store.capture(cwd);
  await writeFile(path.join(cwd, "plain.txt"), "new content\n");
  const after = await store.capture(cwd);
  const service = createWorkspaceGitService({
    resolveWorkspaceRoot: async () => cwd,
    mutateWorkspace: async (_root, operation) => (await operation()).value,
    resolveReviewSnapshots: async () => ({
      gitDir: path.join(await store.directory(cwd), "objects.git"),
      snapshots: [{ id: "turn", timestamp: 1, before, after }],
    }),
  });
  const diff = await service.diff(
    { workspaceId: "workspace", sessionId: "session", scope: "session", path: "plain.txt" },
    new AbortController().signal,
  );
  assert.ok(diff.repository);
  assert.match(diff.patch!, /\+new content/);
});

test("full context and exported binary/rename/untracked patches apply cleanly", async (t) => {
  const { readFile } = await import("node:fs/promises");
  const { runWorkspaceGitCommand } = await import("../src/git");
  const root = await mkdtemp(path.join(tmpdir(), "workbench-review-export-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "source");
  await mkdir(cwd);
  const git = (...args: string[]) => exec("git", args, { cwd });
  await git("init", "--initial-branch=main");
  await git("config", "user.name", "Review Test");
  await git("config", "user.email", "review@example.invalid");
  const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n") + "\n";
  await writeFile(path.join(cwd, "original.txt"), lines);
  await git("add", ".");
  await git("commit", "-m", "baseline");
  const target = path.join(root, "target");
  await git("clone", "--quiet", cwd, target);
  await git("mv", "original.txt", "renamed.txt");
  await writeFile(path.join(cwd, "renamed.txt"), lines.replace("line 50", "edited line 50"));
  await writeFile(path.join(cwd, "binary.dat"), Buffer.from([0, 255, 100, 0, 42]));
  const strange = "新文件\n[1].txt";
  await writeFile(path.join(cwd, strange), "$(do-not-execute)\n");
  const dependencies = {
    resolveWorkspaceRoot: async () => cwd,
    mutateWorkspace: async <T>(_cwd: string, operation: () => Promise<{ value: T }>) =>
      (await operation()).value,
  };
  const service = createWorkspaceGitService(dependencies);
  const read = async (input: Omit<WorkbenchWorkspaceGitDiffRequest, "workspaceId" | "scope">) => {
    const result = await service.diff(
      { workspaceId: "workspace", scope: "uncommitted", ...input },
      new AbortController().signal,
    );
    assert.ok(result.repository);
    return result;
  };
  assert.ok(!(await read({ path: "renamed.txt" })).patch!.includes("line 99"));
  assert.ok((await read({ path: "renamed.txt", fullContext: true })).patch!.includes("line 99"));
  let page = await read({ exportPatch: true });
  let patch = page.patch!;
  while (page.nextOffset !== undefined) {
    page = await read({
      exportPatch: true,
      offset: page.nextOffset,
      patchVersion: page.patchVersion,
    });
    patch += page.patch;
  }
  assert.match(patch, /GIT binary patch/);
  assert.match(patch, /rename from original.txt/);
  assert.ok(!patch.includes(cwd));
  const patchFile = path.join(root, "changes.patch");
  await writeFile(patchFile, patch, { mode: 0o600 });
  await exec("git", ["apply", "--binary", patchFile], { cwd: target });
  for (const file of ["renamed.txt", "binary.dat", strange])
    assert.deepEqual(await readFile(path.join(target, file)), await readFile(path.join(cwd, file)));
  const bounded = createWorkspaceGitService({
    ...dependencies,
    runGit: async (args, cwd, signal) => {
      if (args.includes("--patch"))
        throw Object.assign(new Error("output too large"), {
          code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        });
      return runWorkspaceGitCommand(args, cwd, signal);
    },
  });
  await assert.rejects(
    bounded.diff(
      { workspaceId: "workspace", scope: "uncommitted", exportPatch: true },
      new AbortController().signal,
    ),
    { code: "git-diff-too-large", details: { workspaceId: "workspace", reason: "too-large" } },
  );
});
