require("tsx/cjs");

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { TERMINAL_WEBSOCKET_PATH } = require("@workbench/terminal-contracts");
const { BROWSER_WEBSOCKET_PATH } = require("@workbench/browser-contracts");

const nativeRuntime = require("../src/runtime-native.cjs");
const modelResources = require("../src/runtime-model-resources.cjs");
const { createRuntimeArtifactAdmissionPolicy } = require("../src/runtime-admission.cjs");

test("creates an immutable Runtime admission policy without owning an Agent Runtime", () => {
  const agentRuntimeUpgradePaths = Object.freeze(["/api/agent.mux", "/api/agent.host"]);
  const policy = createRuntimeArtifactAdmissionPolicy(agentRuntimeUpgradePaths);

  assert.deepEqual(Object.keys(policy).sort(), [
    "assertModelReadableResourceClassification",
    "collectModelReadableResources",
    "expectedNativeRuntimeFiles",
    "expectedUpgradePaths",
  ]);
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(Object.isFrozen(policy.expectedUpgradePaths), true);
  assert.deepEqual(policy.expectedUpgradePaths, [
    ...agentRuntimeUpgradePaths,
    TERMINAL_WEBSOCKET_PATH,
    BROWSER_WEBSOCKET_PATH,
  ]);
  assert.notStrictEqual(policy.expectedUpgradePaths, agentRuntimeUpgradePaths);
  assert.throws(
    () => createRuntimeArtifactAdmissionPolicy(["/api/agent.mux", 1]),
    /array of strings/u,
  );
  assert.strictEqual(policy.expectedNativeRuntimeFiles, nativeRuntime.expectedNativeRuntimeFiles);
  assert.strictEqual(
    policy.collectModelReadableResources,
    modelResources.collectRuntimeArtifactModelReadableResources,
  );
  assert.strictEqual(
    policy.assertModelReadableResourceClassification,
    modelResources.assertRuntimeArtifactModelReadableResourceClassification,
  );

  const source = readFileSync(path.join(__dirname, "..", "src", "runtime-admission.cjs"), "utf8");
  assert.doesNotMatch(source, /require\(\s*["'][^"']*host-server/u);
  assert.doesNotMatch(source, /@workbench\/agent-runtime-pi-/u);
});
