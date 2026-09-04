require("tsx/cjs");

const { createWorkbenchPaths } = require("../../../scripts/workbench-paths.cjs");
const { resolveDesktopRuntimeArtifact } = require("./runtime-artifact-admission.cjs");
const { resolveInstalledElectronTarget, runStagedNativeSmoke } = require("./native-runtime.cjs");

async function main() {
  const paths = createWorkbenchPaths();
  const target = resolveInstalledElectronTarget();
  const runtimeArtifact = await resolveDesktopRuntimeArtifact({
    artifactRoot: paths.runtimeArtifactRoot,
    expectedTarget: target,
  });
  await runStagedNativeSmoke({
    runtimeArtifact,
    runtimeDirectory: runtimeArtifact.artifactRoot,
    target,
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
