import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import nativeBuild from "./build-node-pty-native.cjs";
import { localRelease } from "./local-release.mjs";

test("builds only the host target; uploads only after asset and remote tag validation", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "workbench-local-release-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "0.2.0" }));
  const target = nativeBuild.targetKey(nativeBuild.currentTarget());
  const output = path.join(root, "release-assets", target);
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, "installer.deb"), "fixture");
  const stalePackages = path.join(root, "dist-electron");
  mkdirSync(stalePackages);
  writeFileSync(path.join(stalePackages, "old-installer.exe"), "stale");
  const commit = "a".repeat(40);
  const calls = [];
  let invalidAssets = false;
  let remoteCommit = commit;
  let refType = "tag";
  const options = {
    root,
    environment: { npm_execpath: path.join(root, "pnpm.cjs") },
    execute(command, args, settings) {
      calls.push({ command, args, settings });
      if (args[0] === "scripts/validate-release-tag.mjs") return JSON.stringify({ commit });
      if (args[0] === "scripts/validate-release-assets.mjs" && invalidAssets)
        throw new Error("checksum mismatch");
      if (command === "gh") {
        if (args[0] === "repo") return "owner/repo\n";
        if (args[1]?.includes("/git/ref/"))
          return JSON.stringify({
            object: { type: refType, sha: refType === "tag" ? "tag-object" : remoteCommit },
          });
        if (args[1]?.includes("/git/tags/"))
          return JSON.stringify({ object: { sha: remoteCommit } });
      }
      return "";
    },
  };
  assert.equal(localRelease({ ...options, args: ["build"] }).target, target);
  assert.equal(existsSync(stalePackages), false);
  assert.equal(
    calls.some(({ command }) => command === "gh"),
    false,
  );
  const cleanupIndex = calls.findIndex(
    ({ args }) => args[0] === "scripts/prepare-workbench-build.cjs",
  );
  const nativeIndex = calls.findIndex(({ args }) => args.includes("native:pty:build"));
  assert.ok(cleanupIndex >= 0 && cleanupIndex < nativeIndex);
  const packaging = calls.find(({ args }) => args.includes("dist:artifact"));
  assert.deepEqual(packaging.args.slice(-2), ["--publish", "never"]);
  assert.equal(packaging.settings.env.WORKBENCH_NODE_PTY_EXPECTED_TARGET, target);
  assert.deepEqual(calls.at(-1).args, [
    "scripts/validate-release-assets.mjs",
    output,
    "v0.2.0",
    commit,
  ]);

  calls.length = 0;
  localRelease({ ...options, args: ["upload"] });
  assert.deepEqual(calls.at(-1).args, [
    "release",
    "upload",
    "v0.2.0",
    path.join(output, "installer.deb"),
    "--repo",
    "owner/repo",
  ]);
  assert.equal(
    calls.some(({ args }) => args.includes("build") || args.includes("create")),
    false,
  );

  calls.length = 0;
  refType = "commit";
  localRelease({ ...options, args: ["upload", "--clobber"] });
  assert.equal(calls.at(-1).args.at(-1), "--clobber");
  assert.equal(
    calls.some(({ args }) => args[1]?.includes("/git/tags/")),
    false,
  );

  calls.length = 0;
  remoteCommit = "b".repeat(40);
  assert.throws(
    () => localRelease({ ...options, args: ["upload"] }),
    /Remote v0.2.0 does not match/u,
  );
  assert.equal(
    calls.some(({ args }) => args[0] === "release"),
    false,
  );

  calls.length = 0;
  invalidAssets = true;
  assert.throws(() => localRelease({ ...options, args: ["upload"] }), /checksum mismatch/u);
  assert.equal(
    calls.some(({ command }) => command === "gh"),
    false,
  );
  assert.throws(() => localRelease({ ...options, args: ["build", "--clobber"] }), /Usage/u);
});
