import assert from "node:assert/strict";
import test from "node:test";

import { WORKSPACE_GIT_LOG_COMMIT_LIMIT } from "@workbench/agent-runtime-contracts/runtime-capabilities";

import {
  countGitStatusEntries,
  createWorkspaceGitService,
  describeGitChangedFiles,
  parseWorkspaceGitLog,
  WorkspaceGitServiceError,
  type WorkspaceGitCommandResult,
  type WorkspaceGitServiceDependencies,
} from "../src/git";

const workspace = {
  workspaceId: "workspace-1",
  path: "/projects/one",
  title: "one",
  sessionIds: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const signal = new AbortController().signal;

function result(stdout = "", exitCode = 0): WorkspaceGitCommandResult {
  return { exitCode, stdout, stderr: "" };
}

function logRecord({
  author = "Ada",
  date = "2026-08-28T10:00:00-07:00",
  decorations = "",
  hash,
  parents = "",
  subject,
}: {
  author?: string;
  date?: string;
  decorations?: string;
  hash: string;
  parents?: string;
  subject: string;
}): string {
  return [hash, hash.slice(0, 8), parents, author, date, subject, decorations].join("\0") + "\0";
}

function harness(overrides: Partial<WorkspaceGitServiceDependencies> = {}) {
  const reloads: boolean[] = [];
  const service = createWorkspaceGitService({
    canonicalizePath: async (value) => value,
    resolveWorkspaceRoot: async (id) => (id === workspace.workspaceId ? workspace.path : undefined),
    async mutateWorkspace(_cwd, operation) {
      const mutation = await operation();
      reloads.push(mutation.changed);
      return mutation.value;
    },
    runGit: async () => result("", 1),
    ...overrides,
  });
  return { reloads, service };
}

test("counts porcelain records without double-counting renamed paths", () => {
  assert.equal(countGitStatusEntries(""), 0);
  assert.equal(countGitStatusEntries("M  app.ts\0?? note.txt\0"), 2);
  assert.equal(countGitStatusEntries("R  new.ts\0old.ts\0?? note.txt\0"), 2);
  assert.equal(countGitStatusEntries(" C copied.ts\0source.ts\0"), 1);
});

test("describes changed files with rename-safe line statistics", () => {
  assert.deepEqual(
    describeGitChangedFiles(
      "M  app.ts\0R  renamed.ts\0old.ts\0?? note.txt\0",
      "3\t1\tapp.ts\0" + "0\t0\t\0old.ts\0renamed.ts\0",
    ),
    [
      { path: "app.ts", kind: "modified", additions: 3, deletions: 1 },
      {
        path: "renamed.ts",
        previousPath: "old.ts",
        kind: "renamed",
        additions: 0,
        deletions: 0,
      },
      { path: "note.txt", kind: "untracked" },
    ],
  );
});

test("parses NUL-delimited Git history records and decorated refs", () => {
  const first = "1".repeat(40);
  const second = "2".repeat(40);
  assert.deepEqual(
    parseWorkspaceGitLog(
      logRecord({
        hash: first,
        parents: `${second} ${"3".repeat(40)}`,
        subject: "Merge feature",
        decorations: "HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1.0.0",
      }) +
        logRecord({
          hash: second,
          subject: "Initial commit",
          decorations: "refs/remotes/origin/HEAD -> refs/remotes/origin/main",
        }),
    ),
    [
      {
        hash: first,
        shortHash: first.slice(0, 8),
        parentHashes: [second, "3".repeat(40)],
        authorName: "Ada",
        authoredAt: "2026-08-28T10:00:00-07:00",
        subject: "Merge feature",
        refs: [
          { name: "HEAD", kind: "head" },
          { name: "main", kind: "local" },
          { name: "origin/main", kind: "remote" },
          { name: "v1.0.0", kind: "tag" },
        ],
      },
      {
        hash: second,
        shortHash: second.slice(0, 8),
        parentHashes: [],
        authorName: "Ada",
        authoredAt: "2026-08-28T10:00:00-07:00",
        subject: "Initial commit",
        refs: [{ name: "origin/HEAD", kind: "remote" }],
      },
    ],
  );
});

test("describes only repositories rooted at the imported workspace", async () => {
  const commands: string[][] = [];
  const { service } = harness({
    runGit: async (args) => {
      commands.push([...args]);
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return result("/projects/one\n");
      }
      if (args[0] === "symbolic-ref") return result("main\n");
      if (args[0] === "for-each-ref") return result("feature/a\nmain\n");
      if (args[0] === "status") {
        return result("M  app.ts\0R  renamed.ts\0old.ts\0?? note.txt\0");
      }
      if (args[0] === "diff") {
        return result("2\t1\tapp.ts\0" + "0\t0\t\0old.ts\0renamed.ts\0");
      }
      throw new Error(`Unexpected git command: ${args.join(" ")}`);
    },
  });

  assert.deepEqual(await service.describe({ workspaceId: workspace.workspaceId }, signal), {
    repository: true,
    branch: "main",
    branches: ["main", "feature/a"],
    changedFileCount: 3,
    changedFiles: [
      { path: "app.ts", kind: "modified", additions: 2, deletions: 1 },
      {
        path: "renamed.ts",
        previousPath: "old.ts",
        kind: "renamed",
        additions: 0,
        deletions: 0,
      },
      { path: "note.txt", kind: "untracked" },
    ],
    changedFilesTruncated: false,
  });
  assert.equal(commands.filter(([command]) => command === "status").length, 1);

  const outside = harness({
    runGit: async (args) =>
      args[0] === "rev-parse" ? result("/projects\n") : result("unexpected"),
  });
  assert.deepEqual(await outside.service.describe({ workspaceId: workspace.workspaceId }, signal), {
    repository: false,
  });
});

test("returns detached HEAD metadata and preserves local branch ordering", async () => {
  const { service } = harness({
    runGit: async (args) => {
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return result("/projects/one\n");
      }
      if (args[0] === "symbolic-ref") return result("", 1);
      if (args[0] === "for-each-ref") return result("zeta\nalpha\n");
      if (args[0] === "status") return result();
      if (args[0] === "diff") return result();
      if (args[0] === "rev-parse" && args[1] === "--short=8") return result("a1b2c3d4\n");
      throw new Error(`Unexpected git command: ${args.join(" ")}`);
    },
  });

  assert.deepEqual(await service.describe({ workspaceId: workspace.workspaceId }, signal), {
    repository: true,
    detachedHead: "a1b2c3d4",
    branches: ["alpha", "zeta"],
    changedFileCount: 0,
    changedFiles: [],
    changedFilesTruncated: false,
  });
});

test("returns a bounded topological Git log for the imported repository", async () => {
  const commands: string[][] = [];
  const history = Array.from({ length: WORKSPACE_GIT_LOG_COMMIT_LIMIT + 1 }, (_, index) => {
    const hash = index.toString(16).padStart(40, "0");
    const parent = (index + 1).toString(16).padStart(40, "0");
    return logRecord({
      hash,
      parents: index === WORKSPACE_GIT_LOG_COMMIT_LIMIT ? "" : parent,
      subject: `Commit ${index}`,
      decorations: index === 0 ? "HEAD -> refs/heads/main" : "",
    });
  });
  const { service } = harness({
    runGit: async (args) => {
      commands.push([...args]);
      if (args[0] === "rev-parse") return result("/projects/one\n");
      if (args[0] === "symbolic-ref") return result("main\n");
      if (args[0] === "for-each-ref") return result("main\n");
      if (args[0] === "status" || args[0] === "diff") return result();
      if (args[0] === "rev-list") {
        assert.deepEqual(args, ["rev-list", "--all", "--count"]);
        return result(`${history.length}\n`);
      }
      if (args[0] === "log") {
        const offset = Number(args.find((arg) => arg.startsWith("--skip="))?.slice(7) ?? 0);
        return result(history.slice(offset, offset + WORKSPACE_GIT_LOG_COMMIT_LIMIT + 1).join(""));
      }
      throw new Error(`Unexpected git command: ${args.join(" ")}`);
    },
  });

  const value = await service.log({ workspaceId: workspace.workspaceId }, signal);
  assert.equal(value.commits.length, WORKSPACE_GIT_LOG_COMMIT_LIMIT);
  assert.equal(value.truncated, true);
  assert.equal(value.totalCount, history.length);
  assert.deepEqual(value.commits[0]?.refs, [
    { name: "HEAD", kind: "head" },
    { name: "main", kind: "local" },
  ]);
  assert.ok(
    commands.some(
      (args) =>
        args[0] === "log" &&
        args.includes("--all") &&
        args.includes("--topo-order") &&
        args.includes(`--max-count=${WORKSPACE_GIT_LOG_COMMIT_LIMIT + 1}`),
    ),
  );
  const nextPage = await service.log(
    { workspaceId: workspace.workspaceId, offset: value.commits.length },
    signal,
  );
  assert.equal(nextPage.commits.length, 1);
  assert.equal(nextPage.truncated, false);
  assert.equal(nextPage.commits[0]?.subject, `Commit ${WORKSPACE_GIT_LOG_COMMIT_LIMIT}`);
  assert.ok(!value.commits.some((commit) => commit.hash === nextPage.commits[0]?.hash));
  const end = await service.log(
    { workspaceId: workspace.workspaceId, offset: value.commits.length + nextPage.commits.length },
    signal,
  );
  assert.deepEqual(end, { commits: [], truncated: false });
  assert.equal(commands.filter((args) => args[0] === "rev-list").length, 1);
});

test("switches and creates local branches inside the serialized project mutation", async () => {
  let current = "main";
  const branches = ["feature/a", "main"];
  const commands: string[][] = [];
  const { reloads, service } = harness({
    runGit: async (args) => {
      commands.push([...args]);
      if (args[0] === "rev-parse") return result("/projects/one\n");
      if (args[0] === "symbolic-ref") return result(`${current}\n`);
      if (args[0] === "for-each-ref") return result(`${branches.join("\n")}\n`);
      if (args[0] === "status") return result();
      if (args[0] === "diff") return result();
      if (args[0] === "check-ref-format") return result();
      if (args[0] === "switch" && args[1] === "--no-guess") {
        current = args[2] ?? current;
        return result();
      }
      if (args[0] === "switch" && args[1] === "-c") {
        current = args[2] ?? current;
        branches.push(current);
        return result();
      }
      throw new Error(`Unexpected git command: ${args.join(" ")}`);
    },
  });

  const switched = await service.switchBranch(
    { workspaceId: workspace.workspaceId, branch: "feature/a" },
    signal,
  );
  assert.equal(switched.repository && switched.branch, "feature/a");
  const created = await service.createBranch(
    { workspaceId: workspace.workspaceId, branch: "feature/new" },
    signal,
  );
  assert.equal(created.repository && created.branch, "feature/new");
  assert.deepEqual(reloads, [true, true]);
  assert.ok(
    commands.some(
      (args) => args[0] === "switch" && args[1] === "--no-guess" && args[2] === "feature/a",
    ),
  );
  assert.ok(
    commands.some((args) => args[0] === "switch" && args[1] === "-c" && args[2] === "feature/new"),
  );
});

test("rejects missing, invalid, existing, and busy branch mutations with stable errors", async () => {
  const baseRunner: WorkspaceGitServiceDependencies["runGit"] = async (args) => {
    if (args[0] === "rev-parse") return result("/projects/one\n");
    if (args[0] === "symbolic-ref") return result("main\n");
    if (args[0] === "for-each-ref") return result("main\n");
    if (args[0] === "status") return result();
    if (args[0] === "diff") return result();
    if (args[0] === "check-ref-format") return result("", 1);
    throw new Error(`Unexpected git command: ${args.join(" ")}`);
  };
  const { service } = harness({ runGit: baseRunner });

  await assert.rejects(
    service.switchBranch({ workspaceId: workspace.workspaceId, branch: "missing" }, signal),
    (error: unknown) =>
      error instanceof WorkspaceGitServiceError && error.code === "git-branch-not-found",
  );
  await assert.rejects(
    service.createBranch({ workspaceId: workspace.workspaceId, branch: "bad name" }, signal),
    (error: unknown) =>
      error instanceof WorkspaceGitServiceError && error.code === "git-branch-invalid",
  );

  const existing = harness({
    runGit: async (args, cwd, requestSignal) =>
      args[0] === "check-ref-format" ? result() : baseRunner(args, cwd, requestSignal),
  });
  await assert.rejects(
    existing.service.createBranch({ workspaceId: workspace.workspaceId, branch: "main" }, signal),
    (error: unknown) =>
      error instanceof WorkspaceGitServiceError && error.code === "git-branch-exists",
  );

  const busy = harness({
    async mutateWorkspace() {
      throw new WorkspaceGitServiceError(
        "session-busy",
        "A related session is currently running.",
        { sessionId: "session-running" },
      );
    },
  });
  await assert.rejects(
    busy.service.switchBranch({ workspaceId: workspace.workspaceId, branch: "main" }, signal),
    (error: unknown) =>
      error instanceof WorkspaceGitServiceError &&
      error.code === "session-busy" &&
      error.details.sessionId === "session-running",
  );
});

test("rejects unknown workspace ids before running Git", async () => {
  let commands = 0;
  const { service } = harness({
    resolveWorkspaceRoot: async () => undefined,
    runGit: async () => {
      commands += 1;
      return result();
    },
  });

  await assert.rejects(
    service.describe({ workspaceId: "missing" }, signal),
    (error: unknown) =>
      error instanceof WorkspaceGitServiceError && error.code === "workspace-not-found",
  );
  assert.equal(commands, 0);
});
