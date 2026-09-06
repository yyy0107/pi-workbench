import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const validator = fileURLToPath(new URL("./validate-release-assets.mjs", import.meta.url));
const targets = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64-glibc",
  "linux-x64-glibc",
  "win32-arm64",
  "win32-x64",
];

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "workbench-release-assets-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  for (const targetKey of targets) {
    const directory = path.join(root, `release-${targetKey}`);
    mkdirSync(directory);
    const asset = (kind) => {
      const filename = `${kind}-${targetKey}.fixture`;
      const filePath = path.join(directory, filename);
      writeFileSync(filePath, `${kind}:${targetKey}\n`);
      return { filename, size: readFileSync(filePath).length, sha256: sha256(filePath) };
    };
    const metadata = {
      schemaVersion: 1,
      kind: "workbench-release-assets",
      targetKey,
      version: "1.2.3",
      commit: "a".repeat(40),
      nodePtyVersion: "1.1.0",
      nativeBuild: asset("native"),
      runtimeInventories: {
        node: asset("node-inventory"),
        electron: asset("electron-inventory"),
      },
      webRuntimeArchive: asset("web-runtime"),
      electronPackages: [asset("electron")],
    };
    const metadataPath = path.join(directory, `release-metadata-${targetKey}.json`);
    writeFileSync(metadataPath, `${JSON.stringify(metadata)}\n`);
    const files = [
      ...Object.values(metadata.runtimeInventories),
      metadata.nativeBuild,
      metadata.webRuntimeArchive,
      ...metadata.electronPackages,
      { filename: path.basename(metadataPath) },
    ];
    writeFileSync(
      path.join(directory, `SHA256SUMS-${targetKey}.txt`),
      `${files
        .sort((left, right) => left.filename.localeCompare(right.filename))
        .map(({ filename }) => `${sha256(path.join(directory, filename))}  ${filename}`)
        .join("\n")}\n`,
    );
  }
  return root;
}

test("accepts exactly one complete checksummed release for each native target", (t) => {
  const root = fixture(t);
  const result = spawnSync(process.execPath, [validator, root, "v1.2.3"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).targets, targets);
});

test("rejects release asset checksum drift", (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, "release-win32-x64", "native-win32-x64.fixture"), "drift\n");
  const result = spawnSync(process.execPath, [validator, root, "v1.2.3"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checksum mismatch/u);
});

test("accepts one native target and rejects assets built from another commit", (t) => {
  const root = path.join(fixture(t), "release-linux-x64-glibc");
  const run = (commit) =>
    spawnSync(process.execPath, [validator, root, "v1.2.3", commit], { encoding: "utf8" });
  const result = run("a".repeat(40));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).targets, ["linux-x64-glibc"]);
  const stale = run("b".repeat(40));
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /Invalid release metadata/u);
});

test("rejects an empty release directory", (t) => {
  const root = fixture(t);
  for (const target of targets) rmSync(path.join(root, `release-${target}`), { recursive: true });
  const result = spawnSync(process.execPath, [validator, root, "v1.2.3"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid release targets/u);
});

test("rejects unrelated files alongside installers before upload", (t) => {
  const root = path.join(fixture(t), "release-linux-x64-glibc");
  writeFileSync(path.join(root, "accidental-upload.txt"), "unrelated");
  const result = spawnSync(process.execPath, [validator, root, "v1.2.3"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unexpected release files/u);
});
