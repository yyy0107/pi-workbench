require("tsx/cjs");

const { lstatSync } = require("node:fs");
const path = require("node:path");

const { assertDesktopRuntimeBudget, formatBytes } = require("./desktop-runtime-budget.cjs");
const { resolveDesktopRendererArtifact } = require("./desktop-renderer-artifact.cjs");
const { resolveInstalledElectronTarget } = require("./native-runtime.cjs");
const { createWorkbenchPaths } = require("../../../scripts/workbench-paths.cjs");

function resolveDesktopRuntimeBudgetDirectory({
  paths = createWorkbenchPaths(),
  argument = process.argv[2],
} = {}) {
  return argument === undefined
    ? paths.electronAppStagingRoot
    : path.resolve(paths.repositoryRoot, argument);
}

async function checkDesktopRuntimeBudget({
  paths = createWorkbenchPaths(),
  argument = process.argv[2],
  assertBudget = assertDesktopRuntimeBudget,
  resolveRenderer = resolveDesktopRendererArtifact,
  resolveTarget = resolveInstalledElectronTarget,
  target,
  log = console.log,
} = {}) {
  const appDirectory = resolveDesktopRuntimeBudgetDirectory({ paths, argument });
  let expectedRendererBuildId;
  if (argument === undefined) {
    const compositionPath = path.join(paths.desktopRuntimeStagingRoot, "desktop-artifacts.json");
    let stats;
    try {
      stats = lstatSync(compositionPath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error("Missing staged desktop composition. Run the Electron staging step first.");
      }
      throw error;
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error("The staged desktop composition must be a regular file.");
    }
    expectedRendererBuildId = resolveRenderer({
      manifestPath: paths.desktopRendererArtifactManifestPath,
    }).manifest.buildId;
  }
  const expectedTarget = target ?? resolveTarget();
  const report = await assertBudget(appDirectory, undefined, {
    expectedRendererBuildId,
    expectedTarget,
  });
  log(
    [
      "[desktop-runtime] Budget passed",
      `app=${formatBytes(report.appBytes)}`,
      `renderer=${formatBytes(report.rendererArtifactReport.bytes)}`,
      `runtime=${formatBytes(report.runtimeArtifactReport.bytes)}`,
      `files=${report.fileCount}`,
      `packages=${report.dependencyPackages.length}`,
      `model-readable-resources=${report.modelReadableResources.length}`,
      "(manifest-owned/model-readable; TS/test-shaped allowed; not startup/NFT/dynamic-loader admission)",
    ].join(" "),
  );
  return report;
}

if (require.main === module) {
  void checkDesktopRuntimeBudget().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = { checkDesktopRuntimeBudget, resolveDesktopRuntimeBudgetDirectory };
