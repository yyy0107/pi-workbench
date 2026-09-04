require("tsx/cjs");

const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { runtimeArtifactTargetKey } = require("@workbench/host-contracts/runtime-artifact-manifest");
const {
  DESKTOP_RUNTIME_ARTIFACT_ADMISSION_POLICY,
  DESKTOP_RUNTIME_UPGRADE_PATHS,
  resolveDesktopRuntimeArtifact,
} = require("../scripts/runtime-artifact-admission.cjs");

const ELECTRON_TARGET = Object.freeze({
  runtimeFlavor: "electron-node",
  platform: "linux",
  arch: "x64",
  targetTriple: "x86_64-unknown-linux-gnu",
  libc: "glibc",
  nodeVersion: "24.18.1",
  nodeModuleAbi: 148,
  napiVersion: 10,
  electronVersion: "43.4.1",
});

function fixture(t) {
  const selectionRoot = mkdtempSync(path.join(os.tmpdir(), "workbench-runtime-admission-"));
  t.after(() => rmSync(selectionRoot, { force: true, recursive: true }));
  const artifactRoot = path.join(selectionRoot, runtimeArtifactTargetKey(ELECTRON_TARGET));
  const manifestPath = path.join(artifactRoot, "artifact-manifest.json");
  mkdirSync(artifactRoot);
  writeFileSync(manifestPath, "{}\n");
  return {
    artifactRoot,
    descriptor: Object.freeze({
      artifactRoot,
      entrypoint: path.join(artifactRoot, "server.mjs"),
      manifest: Object.freeze({ target: ELECTRON_TARGET }),
      manifestPath,
    }),
    manifestPath,
    selectionRoot,
  };
}

test("routes target-key selection through the complete shared admission policy", async (t) => {
  assert.deepEqual(DESKTOP_RUNTIME_UPGRADE_PATHS, [
    "/api/events.mux",
    "/api/events.host",
    "/api/terminal",
  ]);
  assert.strictEqual(
    DESKTOP_RUNTIME_ARTIFACT_ADMISSION_POLICY.expectedUpgradePaths,
    DESKTOP_RUNTIME_UPGRADE_PATHS,
  );
  const value = fixture(t);
  const calls = [];
  const result = await resolveDesktopRuntimeArtifact({
    artifactRoot: value.selectionRoot,
    expectedTarget: ELECTRON_TARGET,
    resolveArtifact: async (options) => {
      calls.push(options);
      return value.descriptor;
    },
  });
  assert.equal(result, value.descriptor);
  assert.deepEqual(calls, [
    {
      manifestPath: value.manifestPath,
      policy: DESKTOP_RUNTIME_ARTIFACT_ADMISSION_POLICY,
      expectedTarget: ELECTRON_TARGET,
    },
  ]);
});

test("rejects a noncanonical explicit manifest path before invoking the shared resolver", async (t) => {
  const value = fixture(t);
  let invoked = false;
  await assert.rejects(
    resolveDesktopRuntimeArtifact({
      manifestPath: path.relative(process.cwd(), value.manifestPath),
      expectedTarget: ELECTRON_TARGET,
      resolveArtifact: async () => {
        invoked = true;
        return value.descriptor;
      },
    }),
    /absolute canonical path/u,
  );
  assert.equal(invoked, false);
});
