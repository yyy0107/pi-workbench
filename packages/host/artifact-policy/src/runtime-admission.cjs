/**
 * The sole Runtime admission policy wiring point.  It deliberately has no host-server import:
 * host-server receives this immutable data/callback object from its application/launcher owner.
 *
 * This file is executed through `tsx/cjs` whenever workspace TypeScript package exports are
 * resolved (the desktop launcher and TypeScript test runner already establish that hook).
 */
const { STREAM_PATHS } = require("@workbench/agent-runtime-pi-protocol/stream");
const { TERMINAL_WEBSOCKET_PATH } = require("@workbench/terminal-contracts");

const nativeRuntime = require("./runtime-native.cjs");
const modelResources = require("./runtime-model-resources.cjs");

const RUNTIME_ARTIFACT_UPGRADE_PATHS = Object.freeze([
  STREAM_PATHS.mux,
  STREAM_PATHS.host,
  TERMINAL_WEBSOCKET_PATH,
]);

/** Ready to pass to `@workbench/host-server/runtime-artifact.resolveRuntimeArtifact`. */
const RUNTIME_ARTIFACT_ADMISSION_POLICY = Object.freeze({
  expectedUpgradePaths: RUNTIME_ARTIFACT_UPGRADE_PATHS,
  expectedNativeRuntimeFiles: nativeRuntime.expectedNativeRuntimeFiles,
  collectModelReadableResources: modelResources.collectRuntimeArtifactModelReadableResources,
  assertModelReadableResourceClassification:
    modelResources.assertRuntimeArtifactModelReadableResourceClassification,
});

module.exports = Object.freeze({
  RUNTIME_ARTIFACT_ADMISSION_POLICY,
  RUNTIME_ARTIFACT_UPGRADE_PATHS,
});
