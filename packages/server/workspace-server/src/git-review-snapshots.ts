import { execFile, type ExecFileException } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { devNull } from "node:os";
import path from "node:path";

import type {
  WorkbenchFileChange,
  WorkbenchFileChangeKind,
  WorkbenchFileChangeSet,
} from "@workbench/agent-runtime-contracts/file-changes";

const GIT_COMMAND_TIMEOUT_MS = 60_000;
const GIT_COMMAND_OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;
const FILE_CHANGE_PRESENTATION_LIMIT = 200;
const activeReviewCaptures = new Map<string, symbol>();

export interface GitReviewSnapshot {
  id: string;
  timestamp: number;
  before?: string;
  after?: string;
  changeSet?: WorkbenchFileChangeSet;
}

export interface GitReviewCapture {
  readonly before: string;
  observedPaths(): readonly string[];
  subscribe(listener: (relativePath: string) => void): () => void;
  complete(
    input: Readonly<{ id?: string; threadId: string; timestamp?: number }>,
  ): Promise<GitReviewSnapshot>;
  dispose(): void;
}

export class GitReviewSnapshotConflictError extends Error {
  constructor(
    message = "Workspace changes overlap with changes made after this task run.",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GitReviewSnapshotConflictError";
  }
}

/** A task must receive a distinct worktree or overlay before it can be tracked concurrently. */
export class GitReviewSnapshotIsolationError extends Error {
  constructor() {
    super("Another task is already changing this workspace; use an isolated worktree or overlay.");
    this.name = "GitReviewSnapshotIsolationError";
  }
}

interface GitCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface GitCommandOptions {
  readonly input?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly allowedExitCodes?: readonly number[];
}

function runGit(
  cwd: string,
  args: readonly string[],
  options: GitCommandOptions = {},
): Promise<GitCommandResult> {
  const allowed = options.allowedExitCodes ?? [0];
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      [...args],
      {
        cwd,
        encoding: "utf8",
        env: {
          ...process.env,
          LC_ALL: "C",
          GIT_TERMINAL_PROMPT: "0",
          ...options.env,
        },
        maxBuffer: GIT_COMMAND_OUTPUT_LIMIT_BYTES,
        timeout: GIT_COMMAND_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const exitCode = error ? Number((error as ExecFileException).code) : 0;
        if (!error || (Number.isInteger(exitCode) && allowed.includes(exitCode))) {
          resolve({ exitCode, stdout, stderr });
          return;
        }
        reject(error);
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(options.input);
  });
}

function privateGitArgs(gitDir: string, cwd: string): string[] {
  return [`--git-dir=${gitDir}`, `--work-tree=${cwd}`, "-c", `core.hooksPath=${devNull}`];
}

async function excludedPrivatePath(cwd: string, privateRoot: string): Promise<string | undefined> {
  const relative = path.relative(cwd, await realpath(privateRoot));
  return !relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    ? undefined
    : relative.split(path.sep).join("/");
}

async function captureTree(cwd: string, gitDir: string, privateRoot: string): Promise<string> {
  cwd = await realpath(cwd);
  await mkdir(path.dirname(gitDir), { recursive: true, mode: 0o700 });
  await runGit(cwd, ["init", "--bare", "--quiet", gitDir]);
  const temporary = await mkdtemp(path.join(path.dirname(gitDir), "index-"));
  const env = { GIT_INDEX_FILE: path.join(temporary, "index") };
  const git = privateGitArgs(gitDir, cwd);
  try {
    const inRepository = await runGit(cwd, ["rev-parse", "--show-toplevel"], {
      allowedExitCodes: [0, 128],
    }).then((result) => result.exitCode === 0);
    const source = inRepository ? [] : git;
    const sourceOptions = source.length ? { env } : undefined;
    const files = await runGit(
      cwd,
      [...source, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      sourceOptions,
    );
    const deleted = new Set(
      (await runGit(cwd, [...source, "ls-files", "--deleted", "-z"], sourceOptions)).stdout.split(
        "\0",
      ),
    );
    const privatePath = await excludedPrivatePath(cwd, privateRoot);
    const present = [
      ...new Set(
        files.stdout
          .split("\0")
          .filter(
            (file) =>
              file &&
              !deleted.has(file) &&
              (!privatePath || (file !== privatePath && !file.startsWith(`${privatePath}/`))),
          ),
      ),
    ];
    await runGit(cwd, [...git, "read-tree", "--empty"], { env });
    if (present.length) {
      await runGit(
        cwd,
        [
          ...git,
          "--literal-pathspecs",
          "add",
          "--force",
          "--pathspec-from-file=-",
          "--pathspec-file-nul",
        ],
        { env, input: `${present.join("\0")}\0` },
      );
    }
    const tree = (await runGit(cwd, [...git, "write-tree"], { env })).stdout.trim();
    await runGit(cwd, [...git, "update-ref", `refs/snapshots/${randomUUID()}`, tree], { env });
    return tree;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

interface ParsedNameStatus {
  readonly path: string;
  readonly previousPath?: string;
  readonly kind: WorkbenchFileChangeKind;
}

function changeKind(status: string): WorkbenchFileChangeKind {
  if (status.startsWith("A")) return "added";
  if (status.startsWith("D")) return "deleted";
  if (status.startsWith("R")) return "renamed";
  if (status.startsWith("C")) return "copied";
  return "modified";
}

function parseNameStatus(output: string): ParsedNameStatus[] {
  const records = output.split("\0");
  const changes: ParsedNameStatus[] = [];
  for (let index = 0; index < records.length;) {
    const status = records[index++];
    if (!status) break;
    const kind = changeKind(status);
    if (kind === "renamed" || kind === "copied") {
      const previousPath = records[index++];
      const filePath = records[index++];
      if (previousPath && filePath) changes.push({ path: filePath, previousPath, kind });
      continue;
    }
    const filePath = records[index++];
    if (filePath) changes.push({ path: filePath, kind });
  }
  return changes;
}

interface GitLineStats {
  readonly additions?: number;
  readonly deletions?: number;
  readonly binary?: boolean;
}

function parseLineCount(value: string): number | undefined {
  return /^\d+$/.test(value) ? Number(value) : undefined;
}

function parseNumstat(output: string): ReadonlyMap<string, GitLineStats> {
  const records = output.split("\0");
  const stats = new Map<string, GitLineStats>();
  for (let index = 0; index < records.length;) {
    const record = records[index++];
    if (!record) break;
    const firstSeparator = record.indexOf("\t");
    const secondSeparator = record.indexOf("\t", firstSeparator + 1);
    if (firstSeparator < 0 || secondSeparator < 0) continue;
    const additions = parseLineCount(record.slice(0, firstSeparator));
    const deletions = parseLineCount(record.slice(firstSeparator + 1, secondSeparator));
    const inlinePath = record.slice(secondSeparator + 1);
    const filePath = inlinePath || records[index + 1];
    if (!inlinePath) index += 2;
    if (!filePath) continue;
    stats.set(filePath, {
      ...(additions === undefined || deletions === undefined ? { binary: true } : {}),
      ...(additions === undefined ? {} : { additions }),
      ...(deletions === undefined ? {} : { deletions }),
    });
  }
  return stats;
}

async function describeTrees(
  cwd: string,
  gitDir: string,
  before: string,
  after: string,
  input: Readonly<{ id: string; threadId: string; timestamp: number }>,
): Promise<WorkbenchFileChangeSet> {
  const git = privateGitArgs(gitDir, cwd);
  const [nameStatus, numstat] = await Promise.all([
    runGit(cwd, [
      ...git,
      "diff-tree",
      "-r",
      "-M",
      "-C",
      "--no-commit-id",
      "--name-status",
      "-z",
      before,
      after,
    ]),
    runGit(cwd, [
      ...git,
      "diff-tree",
      "-r",
      "-M",
      "-C",
      "--no-commit-id",
      "--numstat",
      "-z",
      before,
      after,
    ]),
  ]);
  const stats = parseNumstat(numstat.stdout);
  const allFiles: WorkbenchFileChange[] = parseNameStatus(nameStatus.stdout).map((change) => ({
    ...change,
    ...stats.get(change.path),
  }));
  const additions = allFiles.reduce((total, file) => total + (file.additions ?? 0), 0);
  const deletions = allFiles.reduce((total, file) => total + (file.deletions ?? 0), 0);
  return {
    version: 1,
    id: input.id,
    threadId: input.threadId,
    createdAt: input.timestamp,
    files: allFiles.slice(0, FILE_CHANGE_PRESENTATION_LIMIT),
    totalFiles: allFiles.length,
    additions,
    deletions,
    ...(allFiles.length > FILE_CHANGE_PRESENTATION_LIMIT ? { truncated: true } : {}),
    undoAvailable: allFiles.length > 0,
  };
}

function validTree(value: string): boolean {
  return /^[a-f0-9]{40,64}$/.test(value);
}

async function commitTree(
  cwd: string,
  gitDir: string,
  tree: string,
  label: string,
  parent?: string,
): Promise<string> {
  const result = await runGit(
    cwd,
    [`--git-dir=${gitDir}`, "commit-tree", tree, ...(parent === undefined ? [] : ["-p", parent])],
    {
      input: `${label}\n`,
      env: {
        GIT_AUTHOR_NAME: "Workbench",
        GIT_AUTHOR_EMAIL: "workbench@localhost",
        GIT_COMMITTER_NAME: "Workbench",
        GIT_COMMITTER_EMAIL: "workbench@localhost",
      },
    },
  );
  return result.stdout.trim();
}

async function mergeSnapshotTrees(
  cwd: string,
  gitDir: string,
  base: string,
  current: string,
  target: string,
): Promise<string> {
  const baseCommit = await commitTree(cwd, gitDir, base, "Workbench file-change base");
  const currentCommit = await commitTree(
    cwd,
    gitDir,
    current,
    "Workbench current workspace",
    baseCommit,
  );
  const targetCommit = await commitTree(
    cwd,
    gitDir,
    target,
    "Workbench file-change target",
    baseCommit,
  );
  const merge = await runGit(
    cwd,
    [`--git-dir=${gitDir}`, "merge-tree", "--write-tree", currentCommit, targetCommit],
    { allowedExitCodes: [0, 1] },
  );
  const tree = merge.stdout.split("\n", 1)[0]?.trim();
  if (merge.exitCode !== 0 || !tree || !validTree(tree)) {
    throw new GitReviewSnapshotConflictError();
  }
  return tree;
}

export async function restoreGitReviewSnapshot(
  cwd: string,
  gitDir: string,
  input: Readonly<{ expected: string; target: string }>,
): Promise<{ readonly merged: boolean }> {
  if (!validTree(input.expected) || !validTree(input.target)) {
    throw new Error("Invalid workspace snapshot reference.");
  }
  cwd = await realpath(cwd);
  if (activeReviewCaptures.has(cwd)) throw new GitReviewSnapshotIsolationError();
  gitDir = await realpath(gitDir);
  const privateRoot = path.dirname(path.dirname(gitDir));
  const current = await captureTree(cwd, gitDir, privateRoot);
  const merged =
    current === input.expected
      ? input.target
      : await mergeSnapshotTrees(cwd, gitDir, input.expected, current, input.target);
  if (merged === current) return { merged: current !== input.expected };

  const git = privateGitArgs(gitDir, cwd);
  try {
    const patch = await runGit(cwd, [...git, "diff", "--binary", "--full-index", current, merged]);
    if (!patch.stdout) return { merged: current !== input.expected };
    const apply = [...git, "apply", "--binary", "--whitespace=nowarn"];
    await runGit(cwd, [...apply, "--check"], { input: patch.stdout });
    await runGit(cwd, apply, {
      input: patch.stdout,
    });
    return { merged: current !== input.expected };
  } catch (error) {
    if (error instanceof GitReviewSnapshotConflictError) throw error;
    throw new GitReviewSnapshotConflictError(undefined, { cause: error });
  }
}

/** Private Git object store: never mutates the project's index, refs, hooks or stash. */
export class GitReviewSnapshots {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async directory(cwd: string) {
    return path.join(
      this.root,
      createHash("sha256")
        .update(await realpath(cwd))
        .digest("hex"),
    );
  }

  async capture(cwd: string): Promise<string> {
    const directory = await this.directory(cwd);
    return captureTree(cwd, path.join(directory, "objects.git"), this.root);
  }

  async begin(cwd: string): Promise<GitReviewCapture> {
    cwd = await realpath(cwd);
    if (activeReviewCaptures.has(cwd)) throw new GitReviewSnapshotIsolationError();
    const isolationToken = Symbol(cwd);
    activeReviewCaptures.set(cwd, isolationToken);
    const releaseIsolation = () => {
      if (activeReviewCaptures.get(cwd) === isolationToken) activeReviewCaptures.delete(cwd);
    };
    let before: string;
    try {
      before = await this.capture(cwd);
    } catch (error) {
      releaseIsolation();
      throw error;
    }
    const observed = new Set<string>();
    const listeners = new Set<(relativePath: string) => void>();
    let watcher: FSWatcher | undefined;
    let completed = false;
    const close = () => {
      const current = watcher;
      watcher = undefined;
      current?.close();
    };
    try {
      watcher = watch(cwd, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const relativePath = filename.toString().split(path.sep).join("/");
        if (!relativePath) return;
        observed.add(relativePath);
        for (const listener of listeners) listener(relativePath);
      });
      watcher.on("error", close);
    } catch {
      watcher = undefined;
    }

    return {
      before,
      observedPaths: () => [...observed].sort(),
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      complete: async ({ id = randomUUID(), threadId, timestamp = Date.now() }) => {
        if (completed) throw new Error("Workspace review capture is already complete.");
        completed = true;
        close();
        try {
          const after = await this.capture(cwd);
          const directory = await this.directory(cwd);
          const changeSet = await describeTrees(
            cwd,
            path.join(directory, "objects.git"),
            before,
            after,
            { id, threadId, timestamp },
          );
          return { id, timestamp, before, after, changeSet };
        } finally {
          releaseIsolation();
        }
      },
      dispose() {
        completed = true;
        listeners.clear();
        close();
        releaseIsolation();
      },
    };
  }
}
