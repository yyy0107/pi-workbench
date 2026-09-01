require("tsx/cjs");

const { createWorkbenchPaths } = require("../../../scripts/workbench-paths.cjs");
const { composeDesktopArtifacts } = require("./compose-desktop-artifacts.cjs");
const {
  buildElectronRuntimeArtifact,
  resolveInstalledElectronTarget,
} = require("./native-runtime.cjs");

async function buildDesktopArtifacts({
  paths = createWorkbenchPaths(),
  environment = process.env,
  resolveTarget = resolveInstalledElectronTarget,
  buildRuntimeArtifact = buildElectronRuntimeArtifact,
  compose = composeDesktopArtifacts,
} = {}) {
  const target = resolveTarget();
  const runtimeArtifact = await buildRuntimeArtifact({ environment, paths, target });
  if (!runtimeArtifact?.manifest?.target) {
    throw new Error("The Electron-target Runtime artifact build did not return an artifact.");
  }
  return compose({ paths, resolveTarget: () => target });
}

if (require.main === module) {
  void buildDesktopArtifacts().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { buildDesktopArtifacts };
