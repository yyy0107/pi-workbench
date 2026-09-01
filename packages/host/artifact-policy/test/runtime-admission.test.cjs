require("tsx/cjs");

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { STREAM_PATHS } = require("@workbench/agent-runtime-pi-protocol/stream");
const { TERMINAL_WEBSOCKET_PATH } = require("@workbench/terminal-contracts");

const nativeRuntime = require("../src/runtime-native.cjs");
const modelResources = require("../src/runtime-model-resources.cjs");
const {
  RUNTIME_ARTIFACT_ADMISSION_POLICY,
  RUNTIME_ARTIFACT_UPGRADE_PATHS,
} = require("../src/runtime-admission.cjs");

test("publishes one immutable Runtime admission policy without importing host-server", () => {
  assert.deepEqual(Object.keys(RUNTIME_ARTIFACT_ADMISSION_POLICY).sort(), [
    "assertModelReadableResourceClassification",
    "collectModelReadableResources",
    "expectedNativeRuntimeFiles",
    "expectedUpgradePaths",
  ]);
  assert.equal(Object.isFrozen(RUNTIME_ARTIFACT_ADMISSION_POLICY), true);
  assert.equal(Object.isFrozen(RUNTIME_ARTIFACT_UPGRADE_PATHS), true);
  assert.strictEqual(
    RUNTIME_ARTIFACT_ADMISSION_POLICY.expectedUpgradePaths,
    RUNTIME_ARTIFACT_UPGRADE_PATHS,
  );
  assert.deepEqual(RUNTIME_ARTIFACT_UPGRADE_PATHS, [
    STREAM_PATHS.mux,
    STREAM_PATHS.host,
    TERMINAL_WEBSOCKET_PATH,
  ]);
  assert.strictEqual(
    RUNTIME_ARTIFACT_ADMISSION_POLICY.expectedNativeRuntimeFiles,
    nativeRuntime.expectedNativeRuntimeFiles,
  );
  assert.strictEqual(
    RUNTIME_ARTIFACT_ADMISSION_POLICY.collectModelReadableResources,
    modelResources.collectRuntimeArtifactModelReadableResources,
  );
  assert.strictEqual(
    RUNTIME_ARTIFACT_ADMISSION_POLICY.assertModelReadableResourceClassification,
    modelResources.assertRuntimeArtifactModelReadableResourceClassification,
  );

  const source = readFileSync(path.join(__dirname, "..", "src", "runtime-admission.cjs"), "utf8");
  assert.doesNotMatch(source, /require\(\s*["'][^"']*host-server/u);
});
