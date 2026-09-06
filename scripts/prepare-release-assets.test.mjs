import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import nativeArtifact from "../packages/host/artifact-policy/src/runtime-native.cjs";

test("prepares renderer/runtime packages with normalized native permissions and rejects hash drift", (t) => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "workbench-release-assets-test-")));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const write = (relativePath, value) => {
    const filename = path.join(root, relativePath);
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, typeof value === "string" ? value : JSON.stringify(value));
    return filename;
  };
  for (const relativePath of [
    "scripts/prepare-release-assets.mjs",
    "scripts/validate-release-assets.mjs",
    "scripts/release-update-info.mjs",
    "packages/host/artifact-policy/src/runtime-native.cjs",
  ]) {
    copyFileSync(new URL(`../${relativePath}`, import.meta.url), write(relativePath, ""));
  }
  const target = {
    platform: process.platform,
    arch: process.arch,
    libc: process.platform === "linux" ? "glibc" : "none",
  };
  const targetKey = `${target.platform}-${target.arch}${target.platform === "linux" ? "-glibc" : ""}`;
  const nativeFiles = nativeArtifact
    .expectedNativeRuntimeFiles(target)
    .filter(({ packageName }) => packageName === "node-pty");
  const bytes = "native fixture\n";
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const nativeBuild = {
    kind: "workbench-node-pty-native-build",
    sourceBuild: true,
    target,
    package: { version: "1.1.0" },
    files: [],
  };
  for (const [directory, runtimeFlavor] of [
    [".desktop-build/runtime-node/node", "node"],
    [".desktop-build/runtime-node/electron", "electron-node"],
    ["dist-electron/unpacked/resources/runtime", "electron-node"],
  ]) {
    const files = nativeFiles.map((file) => {
      const relativePath = `node_modules/node-pty/${file.relativePath}`;
      const filename = write(`${directory}/${relativePath}`, bytes);
      chmodSync(filename, file.executable ? 0o755 : 0o644);
      const mode = lstatSync(filename).mode & 0o777;
      if (runtimeFlavor === "node") {
        nativeBuild.files.push({
          path: file.relativePath,
          size: bytes.length,
          sha256,
          mode: target.platform === "win32" ? mode : 0o755,
        });
      }
      return { path: relativePath, size: bytes.length, sha256, mode };
    });
    const runtimeTarget = { ...target, runtimeFlavor };
    write(`${directory}/artifact-manifest.json`, {
      target: runtimeTarget,
      nativeInventory: { path: "native-runtime-inventory.json" },
    });
    write(`${directory}/native-runtime-inventory.json`, { target: runtimeTarget, files });
  }
  write("dist-electron/unpacked/resources/renderer/artifact-manifest.json", {
    kind: "workbench-desktop-renderer-artifact",
  });
  write("apps/web/.next/standalone/server.js", "web fixture\n");
  write("package.json", { version: "0.2.0" });
  for (const args of [
    ["init"],
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "fixture",
    ],
  ]) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const extension =
    target.platform === "win32" ? "exe" : target.platform === "darwin" ? "zip" : "deb";
  write(`dist-electron/Pi-Workbench-0.2.0.${extension}`, "package fixture\n");
  const nativeManifest = write("native-build.json", nativeBuild);
  const run = () =>
    spawnSync(
      process.execPath,
      [
        path.join(root, "scripts/prepare-release-assets.mjs"),
        "--target",
        targetKey,
        "--output",
        path.join(root, "release-assets", targetKey),
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, WORKBENCH_NODE_PTY_NATIVE_BUILD_MANIFEST: nativeManifest },
      },
    );

  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).version, "0.2.0");
  assert.match(JSON.parse(result.stdout).commit, /^[0-9a-f]{40}$/u);
  const verified = spawnSync(
    process.execPath,
    [
      path.join(root, "scripts/validate-release-assets.mjs"),
      path.join(root, "release-assets", targetKey),
      "v0.2.0",
      JSON.parse(result.stdout).commit,
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(verified.status, 0, verified.stderr);
  assert.match(
    readFileSync(
      path.join(root, "release-assets", targetKey, `SHA256SUMS-${targetKey}.txt`),
      "utf8",
    ),
    /Pi-Workbench-0\.2\.0/u,
  );

  nativeBuild.files[0].sha256 = "0".repeat(64);
  write("native-build.json", nativeBuild);
  const drifted = run();
  assert.notEqual(drifted.status, 0);
  assert.match(drifted.stderr, /node-pty hash drifted/u);
});
