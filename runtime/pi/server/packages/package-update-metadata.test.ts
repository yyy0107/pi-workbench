import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  parseNpmVersionOutput,
  resolvePackageUpdateMetadata,
  type PackageUpdateCommandRunner,
} from "./package-update-metadata";

test("parses the target npm version returned for a configured range", () => {
  assert.equal(parseNpmVersionOutput(JSON.stringify("2.4.0")), "2.4.0");
  assert.equal(parseNpmVersionOutput(JSON.stringify(["2.3.0", "2.4.0"])), "2.4.0");
});

test("resolves the installed and target npm versions without exposing the package path", async (t) => {
  const installedPath = await mkdtemp(join(tmpdir(), "workbench-package-update-"));
  t.after(() => rm(installedPath, { recursive: true, force: true }));
  await writeFile(join(installedPath, "package.json"), JSON.stringify({ version: "2.3.0" }));
  const calls: Array<{ command: string; args: readonly string[]; cwd: string }> = [];
  const runCommand: PackageUpdateCommandRunner = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    return JSON.stringify(["2.3.0", "2.4.0"]);
  };

  const metadata = await resolvePackageUpdateMetadata(
    { source: "npm:@example/pi-tools@^2", scope: "user", type: "npm" },
    { getInstalledPath: () => installedPath },
    { getNpmCommand: () => ["corepack", "pnpm", "--"] },
    "/workspace",
    runCommand,
  );

  assert.deepEqual(metadata, { currentVersion: "2.3.0", targetVersion: "2.4.0" });
  assert.deepEqual(calls, [
    {
      command: "corepack",
      args: ["pnpm", "--", "view", "@example/pi-tools@^2", "version", "--json"],
      cwd: "/workspace",
    },
  ]);
});

test("resolves local and upstream Git revisions", async () => {
  const currentRevision = "1".repeat(40);
  const targetRevision = "2".repeat(40);
  const runCommand: PackageUpdateCommandRunner = async (command, args, options) => {
    assert.equal(command, "git");
    if (args.join(" ") === "rev-parse HEAD") return currentRevision;
    if (args.join(" ") === "rev-parse --abbrev-ref @{upstream}") return "origin/main";
    assert.deepEqual(args, ["ls-remote", "origin", "refs/heads/main"]);
    assert.equal(options.env?.GIT_TERMINAL_PROMPT, "0");
    return `${targetRevision}\trefs/heads/main`;
  };

  assert.deepEqual(
    await resolvePackageUpdateMetadata(
      { source: "git:github.com/example/pi-tools", scope: "project", type: "git" },
      { getInstalledPath: () => "/packages/pi-tools" },
      { getNpmCommand: () => undefined },
      "/workspace",
      runCommand,
    ),
    { currentRevision, targetRevision },
  );
});

test("keeps the authoritative update result usable when metadata lookup fails", async () => {
  const metadata = await resolvePackageUpdateMetadata(
    { source: "git:github.com/example/pi-tools", scope: "user", type: "git" },
    { getInstalledPath: () => "/packages/pi-tools" },
    { getNpmCommand: () => undefined },
    "/workspace",
    async () => {
      throw new Error("private command failure");
    },
  );

  assert.deepEqual(metadata, {});
});
