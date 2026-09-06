import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("requires matching application versions, a clean tagged commit, and main ancestry", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "workbench-release-tag-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "scripts"));
  copyFileSync(
    new URL("./validate-release-tag.mjs", import.meta.url),
    path.join(root, "scripts/validate-release-tag.mjs"),
  );
  const write = (filename, version = "1.2.3") => {
    const fullPath = path.join(root, filename);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, JSON.stringify({ version }));
  };
  for (const filename of [
    "package.json",
    "apps/web/package.json",
    "apps/runtime-node/package.json",
    "apps/desktop-electron/package.json",
    "apps/desktop-renderer/package.json",
  ])
    write(filename);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "fixture");
  git("tag", "v1.2.3");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  const run = () =>
    spawnSync(process.execPath, ["scripts/validate-release-tag.mjs", "v1.2.3"], {
      cwd: root,
      encoding: "utf8",
    });
  assert.equal(run().status, 0);
  write("apps/desktop-renderer/package.json", "1.2.4");
  assert.match(run().stderr, /desktop-renderer\/package.json version/u);
  git("checkout", "--", "apps/desktop-renderer/package.json");
  write("untracked.json");
  assert.match(run().stderr, /clean checkout/u);
  rmSync(path.join(root, "untracked.json"));
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-m",
    "newer main",
  );
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  assert.match(run().stderr, /but HEAD is/u);
  git("checkout", "v1.2.3");
  assert.equal(run().status, 0, "the tagged release remains valid after main advances");
});
