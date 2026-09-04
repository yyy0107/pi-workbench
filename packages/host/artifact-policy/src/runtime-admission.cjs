/**
 * Shared Runtime artifact admission policy pieces. The application/launcher owner supplies the
 * concrete Agent Runtime upgrade paths, keeping this Workbench package runtime-neutral.
 *
 * This file is executed through `tsx/cjs` whenever workspace TypeScript package exports are
 * resolved (the desktop launcher and TypeScript test runner already establish that hook).
 */
const { TERMINAL_WEBSOCKET_PATH } = require("@workbench/terminal-contracts");

const nativeRuntime = require("./runtime-native.cjs");
const modelResources = require("./runtime-model-resources.cjs");

/** Ready to pass to `@workbench/host-server/runtime-artifact.resolveRuntimeArtifact`. */
function createRuntimeArtifactAdmissionPolicy(agentRuntimeUpgradePaths) {
  if (
    !Array.isArray(agentRuntimeUpgradePaths) ||
    !agentRuntimeUpgradePaths.every((value) => typeof value === "string")
  ) {
    throw new Error("Agent Runtime upgrade paths must be an array of strings.");
  }
  return Object.freeze({
    expectedUpgradePaths: Object.freeze([...agentRuntimeUpgradePaths, TERMINAL_WEBSOCKET_PATH]),
    expectedNativeRuntimeFiles: nativeRuntime.expectedNativeRuntimeFiles,
    collectModelReadableResources: modelResources.collectRuntimeArtifactModelReadableResources,
    assertModelReadableResourceClassification:
      modelResources.assertRuntimeArtifactModelReadableResourceClassification,
  });
}

module.exports = Object.freeze({
  createRuntimeArtifactAdmissionPolicy,
});
