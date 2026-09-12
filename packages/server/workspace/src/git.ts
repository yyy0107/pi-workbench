export { GitReviewSnapshots, type GitReviewSnapshot } from "./git-review-snapshots";
import { execFile, type ExecFileException } from "node:child_process";
import { createHash } from "node:crypto";
import { devNull } from "node:os";
import { realpath } from "node:fs/promises";
import path from "node:path";

import {
  type WorkbenchWorkspaceGitDiff,
  type WorkbenchWorkspaceGitDiffRequest,
  type WorkbenchWorkspaceGitCommit as WorkspaceGitCommit,
  type WorkbenchWorkspaceGitCommitRef as WorkspaceGitCommitRef,
  type WorkbenchWorkspaceGitChangedFile as WorkspaceGitChangedFile,
  type WorkbenchWorkspaceGitChangeKind as WorkspaceGitChangeKind,
  type WorkbenchWorkspaceGitBranchRequest as WorkspaceGitCreateBranchPayload,
  type WorkbenchWorkspaceGitRequest as WorkspaceGitDescribePayload,
  type WorkbenchWorkspaceGitLog as WorkspaceGitLogValue,
  type WorkbenchWorkspaceGitLogRequest,
  type WorkbenchWorkspaceGitStatus as WorkspaceGitStatus,
  type WorkbenchWorkspaceGitBranchRequest as WorkspaceGitSwitchBranchPayload,
} from "@workbench/agent-runtime-contracts/runtime-capabilities";
import { WORKSPACE_GIT_LOG_COMMIT_LIMIT } from "@workbench/agent-runtime-contracts/runtime-capabilities";

import { RpcDomainError } from "@workbench/server-core/rpc-domain-error";
const GIT_COMMAND_OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;
const GIT_COMMAND_TIMEOUT_MS = 60_000;
const WORKSPACE_GIT_CHANGED_FILE_LIMIT = 200;

export interface WorkspaceGitCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type WorkspaceGitCommandRunner = (
  args: readonly string[],
  cwd: string,
  signal: AbortSignal,
) => Promise<WorkspaceGitCommandResult>;

interface WorkspaceRoot {
  workspaceId: string;
  path: string;
}
export interface WorkspaceMutationResult<Value> {
  readonly value: Value;
  readonly changed: boolean;
}
export interface WorkspaceGitServiceDependencies {
  readonly canonicalizePath: (value: string) => Promise<string>;
  readonly mutateWorkspace: <Value>(
    rootPath: string,
    operation: () => Promise<WorkspaceMutationResult<Value>>,
  ) => Promise<Value>;
  readonly resolveWorkspaceRoot: (workspaceId: string) => Promise<string | undefined>;
  readonly runGit: WorkspaceGitCommandRunner;
  readonly resolveReviewSnapshots?: (
    cwd: string,
    sessionId: string,
  ) => Promise<{
    gitDir: string;
    snapshots: import("./git-review-snapshots").GitReviewSnapshot[];
  }>;
}

export interface WorkspaceGitProtocol {
  describe(input: WorkspaceGitDescribePayload, signal: AbortSignal): Promise<WorkspaceGitStatus>;
  diff(
    input: WorkbenchWorkspaceGitDiffRequest,
    signal: AbortSignal,
  ): Promise<WorkbenchWorkspaceGitDiff>;
  log(input: WorkbenchWorkspaceGitLogRequest, signal: AbortSignal): Promise<WorkspaceGitLogValue>;
  switchBranch(
    input: WorkspaceGitSwitchBranchPayload,
    signal: AbortSignal,
  ): Promise<WorkspaceGitStatus>;
  createBranch(
    input: WorkspaceGitCreateBranchPayload,
    signal: AbortSignal,
  ): Promise<WorkspaceGitStatus>;
}

export interface WorkspaceGitServiceErrorDetails {
  "workspace-not-found": { workspaceId: string };
  "git-unavailable": Record<string, never>;
  "git-not-repository": { workspaceId: string };
  "git-status-failed": { workspaceId: string };
  "git-diff-failed": { workspaceId: string };
  "git-diff-stale": { workspaceId: string };
  "git-diff-invalid": { workspaceId: string };
  "git-diff-too-large": { workspaceId: string; reason: "too-large" };
  "git-log-failed": { workspaceId: string };
  "git-branch-invalid": { branch: string };
  "git-branch-not-found": { workspaceId: string; branch: string };
  "git-branch-exists": { workspaceId: string; branch: string };
  "git-switch-failed": { workspaceId: string; branch: string };
  "git-create-failed": { workspaceId: string; branch: string };
  "session-busy": { sessionId: string };
}

export type WorkspaceGitServiceErrorCode = keyof WorkspaceGitServiceErrorDetails;

export class WorkspaceGitServiceError<
  Code extends WorkspaceGitServiceErrorCode = WorkspaceGitServiceErrorCode,
> extends RpcDomainError<Code, WorkspaceGitServiceErrorDetails[Code]> {
  readonly code: Code;
  readonly details: WorkspaceGitServiceErrorDetails[Code];

  constructor(
    code: Code,
    message: string,
    details: WorkspaceGitServiceErrorDetails[Code],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkspaceGitServiceError";
    this.code = code;
    this.details = details;
  }
}

class GitExecutableUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super("Git is not available on the Workbench host.", options);
    this.name = "GitExecutableUnavailableError";
  }
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

export function runWorkspaceGitCommand(
  args: readonly string[],
  cwd: string,
  signal: AbortSignal,
): Promise<WorkspaceGitCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [...args],
      {
        cwd,
        encoding: "utf8",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
        maxBuffer: GIT_COMMAND_OUTPUT_LIMIT_BYTES,
        signal,
        timeout: GIT_COMMAND_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ exitCode: 0, stdout, stderr });
          return;
        }
        if (isAbortError(error, signal)) {
          reject(error);
          return;
        }
        const commandError = error as ExecFileException;
        if (commandError.code === "ENOENT") {
          reject(new GitExecutableUnavailableError({ cause: error }));
          return;
        }
        if (typeof commandError.code === "number") {
          resolve({ exitCode: commandError.code, stdout, stderr });
          return;
        }
        reject(error);
      },
    );
  });
}

interface GitStatusEntry {
  path: string;
  previousPath?: string;
  kind: WorkspaceGitChangeKind;
}

function classifyGitStatus(status: string): WorkspaceGitChangeKind {
  if (status === "??") return "untracked";
  if (status.includes("U") || status === "AA" || status === "DD") return "conflicted";
  if (status.includes("R")) return "renamed";
  if (status.includes("C")) return "copied";
  if (status.includes("D")) return "deleted";
  if (status.includes("A")) return "added";
  return "modified";
}

/** Parses porcelain-v1 `-z` records without treating a rename's second path as another file. */
function parseGitStatusEntries(output: string): GitStatusEntry[] {
  const records = output.split("\0");
  const entries: GitStatusEntry[] = [];
  for (let index = 0; index < records.length;) {
    const record = records[index];
    if (!record) break;
    const status = record.slice(0, 2);
    const renamedOrCopied = status.includes("R") || status.includes("C");
    const previousPath = renamedOrCopied ? records[index + 1] || undefined : undefined;
    entries.push({
      path: record.slice(3),
      ...(previousPath ? { previousPath } : {}),
      kind: classifyGitStatus(status),
    });
    index += renamedOrCopied ? 2 : 1;
  }
  return entries;
}

/** Counts porcelain-v1 `-z` records without counting a rename's second path as another file. */
export function countGitStatusEntries(output: string): number {
  return parseGitStatusEntries(output).length;
}

interface GitLineStats {
  binary?: boolean;
  additions?: number;
  deletions?: number;
}

function parseLineCount(value: string): number | undefined {
  return /^\d+$/.test(value) ? Number(value) : undefined;
}

/** Parses `git diff --numstat -z`, including its three-record rename representation. */
function parseGitNumstat(output: string): Map<string, GitLineStats> {
  const records = output.split("\0");
  const stats = new Map<string, GitLineStats>();
  for (let index = 0; index < records.length;) {
    const record = records[index];
    if (!record) break;
    const firstSeparator = record.indexOf("\t");
    const secondSeparator = record.indexOf("\t", firstSeparator + 1);
    if (firstSeparator < 0 || secondSeparator < 0) {
      index += 1;
      continue;
    }
    const additions = parseLineCount(record.slice(0, firstSeparator));
    const deletions = parseLineCount(record.slice(firstSeparator + 1, secondSeparator));
    const inlinePath = record.slice(secondSeparator + 1);
    const path = inlinePath || records[index + 2];
    if (path) {
      stats.set(path, {
        ...(record.startsWith("-\t-\t") ? { binary: true } : {}),
        ...(additions === undefined ? {} : { additions }),
        ...(deletions === undefined ? {} : { deletions }),
      });
    }
    index += inlinePath ? 1 : 3;
  }
  return stats;
}

export function describeGitChangedFiles(
  statusOutput: string,
  numstatOutput: string,
): WorkspaceGitChangedFile[] {
  const stats = parseGitNumstat(numstatOutput);
  return parseGitStatusEntries(statusOutput).map((entry) => ({
    ...entry,
    ...stats.get(entry.path),
  }));
}

function parseGitCommitRef(value: string): WorkspaceGitCommitRef | undefined {
  const symbolicSeparator = value.indexOf(" -> ");
  const ref = (symbolicSeparator < 0 ? value : value.slice(0, symbolicSeparator)).trim();
  if (!ref) return undefined;
  if (ref === "HEAD") return { name: "HEAD", kind: "head" };
  if (ref.startsWith("tag: refs/tags/")) {
    return { name: ref.slice("tag: refs/tags/".length), kind: "tag" };
  }
  if (ref.startsWith("refs/tags/")) {
    return { name: ref.slice("refs/tags/".length), kind: "tag" };
  }
  if (ref.startsWith("refs/heads/")) {
    return { name: ref.slice("refs/heads/".length), kind: "local" };
  }
  if (ref.startsWith("refs/remotes/")) {
    return { name: ref.slice("refs/remotes/".length), kind: "remote" };
  }
  return { name: ref.startsWith("refs/") ? ref.slice("refs/".length) : ref, kind: "other" };
}

function parseGitCommitRefs(value: string): WorkspaceGitCommitRef[] {
  const refs: WorkspaceGitCommitRef[] = [];
  const seen = new Set<string>();
  const append = (ref: WorkspaceGitCommitRef | undefined) => {
    if (!ref) return;
    const key = `${ref.kind}:${ref.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };

  for (const decoration of value.split(", ")) {
    const trimmed = decoration.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("HEAD -> ")) {
      append({ name: "HEAD", kind: "head" });
      append(parseGitCommitRef(trimmed.slice("HEAD -> ".length)));
      continue;
    }
    append(parseGitCommitRef(trimmed));
  }
  return refs;
}

/** Parses the fixed-width NUL-delimited records emitted by the workspace Git log command. */
export function parseWorkspaceGitLog(output: string): WorkspaceGitCommit[] {
  const fields = output.split("\0");
  if (fields.at(-1) === "") fields.pop();

  const commits: WorkspaceGitCommit[] = [];
  for (let index = 0; index + 6 < fields.length; index += 7) {
    const hash = fields[index] ?? "";
    const shortHash = fields[index + 1] ?? "";
    if (!hash || !shortHash) continue;
    commits.push({
      hash,
      shortHash,
      parentHashes: (fields[index + 2] ?? "").split(" ").filter(Boolean),
      authorName: fields[index + 3] ?? "",
      authoredAt: fields[index + 4] ?? "",
      subject: fields[index + 5] ?? "",
      refs: parseGitCommitRefs(fields[index + 6] ?? ""),
    });
  }
  return commits;
}

function compareBranches(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

class DefaultWorkspaceGitService implements WorkspaceGitProtocol {
  private readonly dependencies: WorkspaceGitServiceDependencies;

  constructor(dependencies: WorkspaceGitServiceDependencies) {
    this.dependencies = dependencies;
  }

  async describe(
    input: WorkspaceGitDescribePayload,
    signal: AbortSignal,
  ): Promise<WorkspaceGitStatus> {
    const workspace = await this.requireWorkspace(input.workspaceId);
    return this.readStatus(workspace, signal);
  }

  async diff(
    input: WorkbenchWorkspaceGitDiffRequest,
    signal: AbortSignal,
  ): Promise<WorkbenchWorkspaceGitDiff> {
    const workspace = await this.requireWorkspace(input.workspaceId);
    const repositoryStatus = await this.readStatus(workspace, signal);
    if (!repositoryStatus.repository && input.scope !== "session" && input.scope !== "last-turn")
      return repositoryStatus;
    const status = repositoryStatus.repository
      ? repositoryStatus
      : { branches: [] as string[], branch: undefined, detachedHead: undefined };
    const details = { workspaceId: input.workspaceId };
    const invalid = () =>
      new WorkspaceGitServiceError("git-diff-invalid", "Invalid Git comparison or file.", details);
    if (
      ![
        "uncommitted",
        "unstaged",
        "staged",
        "branch",
        "commit",
        "range",
        "session",
        "last-turn",
      ].includes(input.scope) ||
      !Number.isSafeInteger(input.offset ?? 0) ||
      (input.offset ?? 0) < 0
    )
      throw invalid();
    let gitPrefix: string[] = [];
    const run = async (args: string[], allowDifference = false) => {
      const result = await this.runCommand(
        [...gitPrefix, ...args],
        workspace,
        signal,
        "git-diff-failed",
        details,
      );
      if (result.exitCode !== 0 && !(allowDifference && result.exitCode === 1)) {
        throw new WorkspaceGitServiceError(
          "git-diff-failed",
          "The Git diff could not be read.",
          details,
        );
      }
      return result.stdout;
    };
    const remoteBranches = repositoryStatus.repository
      ? (await run(["for-each-ref", "--format=%(refname:short)", "refs/remotes/"]))
          .trim()
          .split("\n")
          .filter((branch) => branch && !branch.endsWith("/HEAD"))
      : [];
    const branches = [...status.branches, ...remoteBranches];
    const revisions: string[] = input.scope === "staged" ? ["--cached"] : [];
    if (input.scope === "uncommitted") {
      const head = await this.runCommand(
        ["rev-parse", "--verify", "HEAD"],
        workspace,
        signal,
        "git-diff-failed",
        details,
      );
      revisions.push(
        head.exitCode === 0
          ? head.stdout.trim()
          : (await run(["hash-object", "-t", "tree", devNull])).trim(),
      );
    }
    if (input.scope === "branch") {
      if (!input.revision || !branches.includes(input.revision)) throw invalid();
      const base = (
        await run([
          "merge-base",
          "HEAD",
          `${status.branches.includes(input.revision) ? "refs/heads" : "refs/remotes"}/${input.revision}`,
        ])
      ).trim();
      if (!/^[a-f0-9]{40,64}$/.test(base)) throw invalid();
      revisions.push(base, "HEAD");
    }
    if (input.scope === "commit" || input.scope === "range") {
      const resolveCommit = async (revision: string | undefined) => {
        if (!revision || !/^[a-f0-9]{4,64}$/i.test(revision)) throw invalid();
        return (
          await run(["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`])
        ).trim();
      };
      const last = await resolveCommit(input.revision);
      const first = input.scope === "range" ? await resolveCommit(input.baseRevision) : last;
      if (input.scope === "range") await run(["merge-base", "--is-ancestor", first, last]);
      const parents = (await run(["rev-list", "--parents", "-n", "1", first])).trim().split(" ");
      const base = parents[1] ?? (await run(["hash-object", "-t", "tree", devNull])).trim();
      revisions.push(base, last);
    }
    let turns: { id: string; timestamp: number }[] | undefined;
    if (input.scope === "session" || input.scope === "last-turn") {
      if (!input.sessionId || !this.dependencies.resolveReviewSnapshots) throw invalid();
      const history = await this.dependencies.resolveReviewSnapshots(
        workspace.path,
        input.sessionId,
      );
      turns = history.snapshots.map(({ id, timestamp }) => ({ id, timestamp }));
      const selected = input.revision
        ? history.snapshots.find((turn) => turn.id === input.revision)
        : history.snapshots.at(-1);
      const first = input.scope === "session" ? history.snapshots[0] : selected;
      const last = input.scope === "session" ? history.snapshots.at(-1) : selected;
      if (!first?.before || !last?.after)
        return {
          repository: true,
          branches: status.branches,
          branch: status.branch,
          files: [],
          turns,
          unrecorded: true,
        };
      gitPrefix = [`--git-dir=${history.gitDir}`];
      revisions.push(first.before, last.after);
    }
    const diffArgs = [
      "--literal-pathspecs",
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--find-renames",
    ];
    const [names, stats] = await Promise.all([
      run([...diffArgs, "--name-status", "-z", ...revisions, "--"]),
      run([...diffArgs, "--numstat", "-z", ...revisions, "--"]),
    ]);
    const counts = parseGitNumstat(stats);
    const records = names.split("\0");
    const byPath = new Map<string, WorkspaceGitChangedFile>();
    for (let index = 0; records[index];) {
      const code = records[index++];
      const firstPath = records[index++];
      const previousPath = /^[RC]/.test(code) ? firstPath : undefined;
      const filePath = previousPath ? records[index++] : firstPath;
      if (byPath.get(filePath)?.kind !== "conflicted")
        byPath.set(filePath, {
          path: filePath,
          kind: classifyGitStatus(code),
          ...(previousPath ? { previousPath } : {}),
          ...counts.get(filePath),
        });
    }
    const files = [...byPath.values()];
    if (input.scope === "unstaged" || input.scope === "uncommitted") {
      const untracked = await run(["ls-files", "--others", "--exclude-standard", "-z"]);
      for (const filePath of untracked.split("\0").filter(Boolean)) {
        files.push({ path: filePath, kind: "untracked" });
      }
    }
    const summary = {
      repository: true as const,
      branch: status.branch ?? status.detachedHead,
      branches,
      ...(turns ? { turns } : {}),
    };
    if (input.path !== undefined || input.exportPatch) {
      if (input.exportPatch && files.some((file) => file.kind === "conflicted")) throw invalid();
      const file =
        input.path === undefined ? undefined : files.find((file) => file.path === input.path);
      if (input.path !== undefined && !file) throw invalid();
      const untrackedPatch = (filePath: string) =>
        run(
          [
            "diff",
            "--no-index",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--binary",
            "--",
            devNull,
            filePath,
          ],
          true,
        );
      let patch =
        file?.kind === "untracked"
          ? await untrackedPatch(file.path)
          : await run([
              ...diffArgs,
              "--patch",
              "--no-color",
              "--binary",
              input.fullContext && !input.exportPatch ? "--unified=2147483647" : "--unified=3",
              ...(file?.kind === "conflicted" && input.scope === "unstaged" ? ["--ours"] : []),
              ...(file?.previousPath ? ["--diff-filter=RC"] : []),
              ...revisions,
              "--",
              ...(file ? [file.path, ...(file.previousPath ? [file.previousPath] : [])] : []),
            ]);
      if (!file) {
        let bytes = Buffer.byteLength(patch);
        for (const file of files) {
          if (file.kind !== "untracked") continue;
          const addition = await untrackedPatch(file.path);
          bytes += Buffer.byteLength(addition);
          if (bytes > GIT_COMMAND_OUTPUT_LIMIT_BYTES)
            throw new WorkspaceGitServiceError(
              "git-diff-too-large",
              "The patch exceeds the review output limit.",
              { ...details, reason: "too-large" },
            );
          patch += addition;
        }
      }
      const patchVersion = createHash("sha256").update(patch).digest("hex");
      if (input.patchVersion && input.patchVersion !== patchVersion) {
        throw new WorkspaceGitServiceError(
          "git-diff-stale",
          "The diff changed. Refresh before continuing.",
          details,
        );
      }
      const offset = input.offset ?? 0;
      // ponytail: bounded text pages; Git's existing 16 MiB command limit remains the ceiling.
      let end = Math.min(patch.length, offset + 32_768);
      if (end < patch.length && /[\uD800-\uDBFF]/.test(patch[end - 1])) end -= 1;
      return {
        ...summary,
        files: [],
        patch: patch.slice(offset, end),
        patchVersion,
        ...(end < patch.length ? { nextOffset: end } : {}),
      };
    }
    const patchVersion = createHash("sha256").update(JSON.stringify(files)).digest("hex");
    if (input.patchVersion && input.patchVersion !== patchVersion) {
      throw new WorkspaceGitServiceError(
        "git-diff-stale",
        "The file list changed. Refresh before continuing.",
        details,
      );
    }
    const offset = input.offset ?? 0;
    const page = files.slice(offset, offset + WORKSPACE_GIT_CHANGED_FILE_LIMIT);
    for (const file of page) {
      if (file.kind !== "untracked") continue;
      const stats = await run(
        [
          "diff",
          "--no-index",
          "--no-ext-diff",
          "--no-textconv",
          "--numstat",
          "-z",
          "--",
          devNull,
          path.join(workspace.path, file.path),
        ],
        true,
      );
      Object.assign(file, [...parseGitNumstat(stats).values()][0]);
    }
    return {
      ...summary,
      files: page,
      patchVersion,
      ...(offset + page.length < files.length ? { nextOffset: offset + page.length } : {}),
    };
  }

  async log(
    input: WorkbenchWorkspaceGitLogRequest,
    signal: AbortSignal,
  ): Promise<WorkspaceGitLogValue> {
    const workspace = await this.requireWorkspace(input.workspaceId);
    await this.requireRepository(workspace, signal);
    const result = await this.runCommand(
      [
        "log",
        "-z",
        "--all",
        "--topo-order",
        "--decorate=full",
        `--max-count=${WORKSPACE_GIT_LOG_COMMIT_LIMIT + 1}`,
        `--skip=${input.offset ?? 0}`,
        "--format=%H%x00%h%x00%P%x00%an%x00%aI%x00%s%x00%D",
      ],
      workspace,
      signal,
      "git-log-failed",
      { workspaceId: input.workspaceId },
    );
    if (result.exitCode !== 0) {
      throw new WorkspaceGitServiceError("git-log-failed", "The Git history could not be read.", {
        workspaceId: input.workspaceId,
      });
    }
    let totalCount: number | undefined;
    if (!input.offset) {
      const count = await this.runCommand(
        ["rev-list", "--all", "--count"],
        workspace,
        signal,
        "git-log-failed",
        { workspaceId: input.workspaceId },
      );
      totalCount = Number(count.stdout.trim());
      if (
        count.exitCode !== 0 ||
        !count.stdout.trim() ||
        !Number.isSafeInteger(totalCount) ||
        totalCount < 0
      ) {
        throw new WorkspaceGitServiceError(
          "git-log-failed",
          "The Git history count could not be read.",
          {
            workspaceId: input.workspaceId,
          },
        );
      }
    }
    const commits = parseWorkspaceGitLog(result.stdout);
    return {
      ...(totalCount === undefined ? {} : { totalCount }),
      commits: commits.slice(0, WORKSPACE_GIT_LOG_COMMIT_LIMIT),
      truncated: commits.length > WORKSPACE_GIT_LOG_COMMIT_LIMIT,
    };
  }

  async switchBranch(
    input: WorkspaceGitSwitchBranchPayload,
    signal: AbortSignal,
  ): Promise<WorkspaceGitStatus> {
    const workspace = await this.requireWorkspace(input.workspaceId);
    try {
      return await this.dependencies.mutateWorkspace(workspace.path, async () => {
        const status = await this.requireRepository(workspace, signal);
        if (!status.branches.includes(input.branch)) {
          throw new WorkspaceGitServiceError(
            "git-branch-not-found",
            "The requested local Git branch does not exist.",
            { workspaceId: input.workspaceId, branch: input.branch },
          );
        }
        if (status.branch === input.branch) return { value: status, changed: false };

        const result = await this.runCommand(
          ["switch", "--no-guess", input.branch],
          workspace,
          signal,
          "git-switch-failed",
          { workspaceId: input.workspaceId, branch: input.branch },
        );
        if (result.exitCode !== 0) {
          throw new WorkspaceGitServiceError(
            "git-switch-failed",
            "The Git branch could not be switched.",
            { workspaceId: input.workspaceId, branch: input.branch },
          );
        }
        return { value: await this.requireRepository(workspace, signal), changed: true };
      });
    } catch (error) {
      if (error instanceof WorkspaceGitServiceError || isAbortError(error, signal)) throw error;
      throw new WorkspaceGitServiceError(
        "git-switch-failed",
        "The Git branch could not be switched.",
        { workspaceId: input.workspaceId, branch: input.branch },
        { cause: error },
      );
    }
  }

  async createBranch(
    input: WorkspaceGitCreateBranchPayload,
    signal: AbortSignal,
  ): Promise<WorkspaceGitStatus> {
    const workspace = await this.requireWorkspace(input.workspaceId);
    try {
      return await this.dependencies.mutateWorkspace(workspace.path, async () => {
        const status = await this.requireRepository(workspace, signal);
        const validation = await this.runCommand(
          ["check-ref-format", "--branch", input.branch],
          workspace,
          signal,
          "git-create-failed",
          { workspaceId: input.workspaceId, branch: input.branch },
        );
        if (validation.exitCode !== 0) {
          throw new WorkspaceGitServiceError(
            "git-branch-invalid",
            "The requested Git branch name is invalid.",
            { branch: input.branch },
          );
        }
        if (status.branches.includes(input.branch)) {
          throw new WorkspaceGitServiceError(
            "git-branch-exists",
            "The requested Git branch already exists.",
            { workspaceId: input.workspaceId, branch: input.branch },
          );
        }

        const result = await this.runCommand(
          ["switch", "-c", input.branch],
          workspace,
          signal,
          "git-create-failed",
          { workspaceId: input.workspaceId, branch: input.branch },
        );
        if (result.exitCode !== 0) {
          throw new WorkspaceGitServiceError(
            "git-create-failed",
            "The Git branch could not be created.",
            { workspaceId: input.workspaceId, branch: input.branch },
          );
        }
        return { value: await this.requireRepository(workspace, signal), changed: true };
      });
    } catch (error) {
      if (error instanceof WorkspaceGitServiceError || isAbortError(error, signal)) throw error;
      throw new WorkspaceGitServiceError(
        "git-create-failed",
        "The Git branch could not be created.",
        { workspaceId: input.workspaceId, branch: input.branch },
        { cause: error },
      );
    }
  }

  private async requireWorkspace(workspaceId: string): Promise<WorkspaceRoot> {
    const rootPath = await this.dependencies.resolveWorkspaceRoot(workspaceId);
    if (!rootPath) {
      throw new WorkspaceGitServiceError("workspace-not-found", "The workspace does not exist.", {
        workspaceId,
      });
    }
    return { workspaceId, path: rootPath };
  }

  private async requireRepository(
    workspace: WorkspaceRoot,
    signal: AbortSignal,
  ): Promise<Extract<WorkspaceGitStatus, { repository: true }>> {
    const status = await this.readStatus(workspace, signal);
    if (!status.repository) {
      throw new WorkspaceGitServiceError(
        "git-not-repository",
        "The workspace is not a Git repository.",
        { workspaceId: workspace.workspaceId },
      );
    }
    return status;
  }

  private async readStatus(
    workspace: WorkspaceRoot,
    signal: AbortSignal,
  ): Promise<WorkspaceGitStatus> {
    const root = await this.runCommand(
      ["rev-parse", "--show-toplevel"],
      workspace,
      signal,
      "git-status-failed",
      { workspaceId: workspace.workspaceId },
    );
    if (root.exitCode !== 0 || !root.stdout.trim()) return { repository: false };

    let workspacePath: string;
    let repositoryPath: string;
    try {
      [workspacePath, repositoryPath] = await Promise.all([
        this.dependencies.canonicalizePath(workspace.path),
        this.dependencies.canonicalizePath(root.stdout.trim()),
      ]);
    } catch (error) {
      throw new WorkspaceGitServiceError(
        "git-status-failed",
        "The Git repository status could not be read.",
        { workspaceId: workspace.workspaceId },
        { cause: error },
      );
    }
    if (path.resolve(workspacePath) !== path.resolve(repositoryPath)) return { repository: false };

    const [symbolicHead, localBranches, changes, lineStats] = await Promise.all([
      this.runCommand(
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        workspace,
        signal,
        "git-status-failed",
        { workspaceId: workspace.workspaceId },
      ),
      this.runCommand(
        ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
        workspace,
        signal,
        "git-status-failed",
        { workspaceId: workspace.workspaceId },
      ),
      this.runCommand(
        ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        workspace,
        signal,
        "git-status-failed",
        { workspaceId: workspace.workspaceId },
      ),
      this.runCommand(
        ["diff", "--numstat", "-z", "--find-renames", "HEAD", "--"],
        workspace,
        signal,
        "git-status-failed",
        { workspaceId: workspace.workspaceId },
      ),
    ]);
    if (localBranches.exitCode !== 0 || changes.exitCode !== 0) {
      throw new WorkspaceGitServiceError(
        "git-status-failed",
        "The Git repository status could not be read.",
        { workspaceId: workspace.workspaceId },
      );
    }

    const branch =
      symbolicHead.exitCode === 0 ? symbolicHead.stdout.trim() || undefined : undefined;
    const branchSet = new Set(
      localBranches.stdout
        .split(/\r?\n/)
        .map((name) => name.trim())
        .filter(Boolean),
    );
    if (branch) branchSet.add(branch);
    const branches = [...branchSet].sort(compareBranches);
    if (branch) {
      const currentIndex = branches.indexOf(branch);
      if (currentIndex > 0) branches.unshift(...branches.splice(currentIndex, 1));
    }

    let detachedHead: string | undefined;
    if (!branch) {
      const detached = await this.runCommand(
        ["rev-parse", "--short=8", "HEAD"],
        workspace,
        signal,
        "git-status-failed",
        { workspaceId: workspace.workspaceId },
      );
      if (detached.exitCode === 0) detachedHead = detached.stdout.trim() || undefined;
    }

    const changedFiles = describeGitChangedFiles(
      changes.stdout,
      lineStats.exitCode === 0 ? lineStats.stdout : "",
    );

    return {
      repository: true,
      ...(branch ? { branch } : {}),
      ...(detachedHead ? { detachedHead } : {}),
      branches,
      changedFileCount: changedFiles.length,
      changedFiles: changedFiles.slice(0, WORKSPACE_GIT_CHANGED_FILE_LIMIT),
      changedFilesTruncated: changedFiles.length > WORKSPACE_GIT_CHANGED_FILE_LIMIT,
    };
  }

  private async runCommand<
    Code extends
      | "git-diff-failed"
      | "git-status-failed"
      | "git-log-failed"
      | "git-switch-failed"
      | "git-create-failed",
  >(
    args: readonly string[],
    workspace: WorkspaceRoot,
    signal: AbortSignal,
    failureCode: Code,
    details: WorkspaceGitServiceErrorDetails[Code],
  ): Promise<WorkspaceGitCommandResult> {
    try {
      return await this.dependencies.runGit(args, workspace.path, signal);
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      if (error instanceof GitExecutableUnavailableError) {
        throw new WorkspaceGitServiceError(
          "git-unavailable",
          "Git is not available on the Workbench host.",
          {},
          { cause: error },
        );
      }
      if (
        failureCode === "git-diff-failed" &&
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
      ) {
        throw new WorkspaceGitServiceError(
          "git-diff-too-large",
          "The patch exceeds the review output limit.",
          { workspaceId: workspace.workspaceId, reason: "too-large" },
        );
      }
      const messages = {
        "git-status-failed": "The Git repository status could not be read.",
        "git-diff-failed": "The Git diff could not be read.",
        "git-log-failed": "The Git history could not be read.",
        "git-switch-failed": "The Git branch could not be switched.",
        "git-create-failed": "The Git branch could not be created.",
      } as const;
      throw new WorkspaceGitServiceError(failureCode, messages[failureCode], details, {
        cause: error,
      });
    }
  }
}

export function createWorkspaceGitService(
  options: Pick<WorkspaceGitServiceDependencies, "resolveWorkspaceRoot" | "mutateWorkspace"> &
    Partial<WorkspaceGitServiceDependencies>,
): WorkspaceGitProtocol {
  return new DefaultWorkspaceGitService({
    canonicalizePath: realpath,
    runGit: runWorkspaceGitCommand,
    ...options,
  });
}
