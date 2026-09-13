import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { devNull } from "node:os";

export interface GitReviewSnapshot {
  id: string;
  timestamp: number;
  before?: string;
  after?: string;
}

/** Private Git object store: never uses the project's index, refs, hooks or stash. */
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
    cwd = await realpath(cwd);
    const directory = await this.directory(cwd);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = await mkdtemp(path.join(directory, "index-"));
    const env = { ...process.env, GIT_INDEX_FILE: path.join(temporary, "index") };
    const run = (args: string[], input?: string) =>
      new Promise<string>((resolve, reject) => {
        const child = execFile(
          "git",
          args,
          {
            cwd,
            env: args.some((arg) => arg.startsWith("--git-dir=")) ? env : process.env,
            encoding: "utf8",
            maxBuffer: 16 * 1024 * 1024,
            timeout: 60_000,
          },
          (error, stdout) => (error ? reject(error) : resolve(stdout)),
        );
        child.stdin?.on("error", () => {});
        child.stdin?.end(input);
      });
    try {
      const gitDir = path.join(directory, "objects.git");
      await run(["init", "--bare", "--quiet", gitDir]);
      const git = [`--git-dir=${gitDir}`, `--work-tree=${cwd}`, "-c", `core.hooksPath=${devNull}`];
      // Git's file catalog excludes ignored build outputs while retaining tracked ignored files.
      const inRepository = await run(["rev-parse", "--show-toplevel"]).then(
        () => true,
        () => false,
      );
      const source = inRepository ? [] : git;
      const files = await run([
        ...source,
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
      ]);
      await run([...git, "read-tree", "--empty"]);
      // Deleted tracked paths are excluded by Git's error-unmatch-free filesystem catalog.
      const deleted = new Set((await run([...source, "ls-files", "--deleted", "-z"])).split("\0"));
      const privatePath = path
        .relative(cwd, await realpath(this.root))
        .split(path.sep)
        .join("/");
      const present = [
        ...new Set(
          files
            .split("\0")
            .filter(
              (file) =>
                file &&
                !deleted.has(file) &&
                file !== privatePath &&
                !file.startsWith(`${privatePath}/`),
            ),
        ),
      ];
      if (present.length)
        await run(
          [
            ...git,
            "--literal-pathspecs",
            "add",
            "--force",
            "--pathspec-from-file=-",
            "--pathspec-file-nul",
          ],
          present.join("\0") + "\0",
        );
      // ponytail: retain referenced trees indefinitely; add retention when review storage needs a quota.
      const tree = (await run([...git, "write-tree"])).trim();
      await run([...git, "update-ref", `refs/snapshots/${randomUUID()}`, tree]);
      return tree;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
