const { preparePackage } = require("./prepare-package.cjs");
const { assertPackagedOutputBudget, formatBytes } = require("./desktop-runtime-budget.cjs");
const {
  buildElectronRuntimeArtifact,
  resolveNativeTarget,
  runStagedNativeSmoke,
} = require("./native-runtime.cjs");
const { runNodeScript } = require("./process-runner.cjs");
const { runStagedApiOnlyRuntimeSmoke } = require("./staged-api-only-runtime-smoke.cjs");
const {
  resolvePackagedAppSmokeContract,
  runPackagedAppSmoke,
} = require("./packaged-app-smoke.cjs");
const { createWorkbenchPaths } = require("../../../scripts/workbench-paths.cjs");

const electronBuilderCli = require.resolve("electron-builder/cli.js");
const ARTIFACT_ONLY_ARGUMENT = "--artifact-only";
const ARTIFACT_ONLY_RESULT_TYPE = "workbench-packaged-app-artifact-validation";

async function buildPackage({
  paths = createWorkbenchPaths(),
  args = process.argv.slice(2),
  environment = process.env,
  prepare = preparePackage,
  resolveTarget = resolveNativeTarget,
  buildRuntimeArtifact = buildElectronRuntimeArtifact,
  run = runNodeScript,
  smoke = runStagedNativeSmoke,
  stagedApiOnlyHostSmoke = runStagedApiOnlyRuntimeSmoke,
  packagedAppSmoke = runPackagedAppSmoke,
  assertBudget = assertPackagedOutputBudget,
  builderCli = electronBuilderCli,
  log = console.log,
} = {}) {
  const artifactOnly = args.includes(ARTIFACT_ONLY_ARGUMENT);
  const builderArgs = args.filter((argument) => argument !== ARTIFACT_ONLY_ARGUMENT);
  const target = resolveTarget(builderArgs, {
    environment,
    expectedAppDirectory: paths.electronAppStagingRoot,
    expectedOutputDirectory: paths.electronOutputRoot,
    projectRoot: paths.desktopElectronRoot,
    repositoryRoot: paths.repositoryRoot,
  });
  const packagedSmokeContract = resolvePackagedAppSmokeContract(target);
  if (packagedSmokeContract.execution !== "required" && !artifactOnly) {
    throw new Error(
      `This target cannot pass the required native packaged-app execution smoke: ${packagedSmokeContract.reason} Use the explicit artifact-only package command to validate layout and budget without claiming Window/RPC/WebSocket/PTY/titlebar/cleanup execution.`,
    );
  }
  const sourceRuntimeArtifact = await buildRuntimeArtifact({ paths, target, environment });
  const prepared = await prepare({
    paths,
    target,
    runtimeArtifact: sourceRuntimeArtifact,
  });
  if (!prepared?.runtimeArtifact || !prepared?.rendererArtifact) {
    throw new Error("Electron staging did not return both manifest-selected artifacts.");
  }
  await smoke({
    runtimeArtifact: prepared.runtimeArtifact,
    runtimeDirectory: paths.desktopRuntimeArtifactStagingRoot,
    target,
    environment,
  });
  await stagedApiOnlyHostSmoke({
    childWorkingDirectory: paths.desktopRuntimeStagingRoot,
    runtimeArtifact: prepared.runtimeArtifact,
    runtimeDirectory: paths.desktopRuntimeArtifactStagingRoot,
    target,
    environment,
  });
  run(builderCli, builderArgs, {
    cwd: paths.desktopElectronRoot,
    env: environment,
    label: "electron-builder",
    stdio: "inherit",
  });
  if (packagedSmokeContract.execution === "required" && !artifactOnly) {
    await packagedAppSmoke({
      outputDirectory: paths.electronOutputRoot,
      target,
      expectedRendererBuildId: prepared.rendererArtifact.manifest.buildId,
      environment,
    });
  } else {
    log(
      `[desktop-runtime] Packaged application execution smoke not run: ${artifactOnly && packagedSmokeContract.execution === "required" ? "explicit artifact-only mode" : packagedSmokeContract.reason} Artifact layout and budget validation continue, but this target has not passed the Window/RPC/WebSocket/PTY/titlebar/cleanup execution contract.`,
    );
  }
  const report = await assertBudget(paths.electronOutputRoot, {
    expectedRendererBuildId: prepared.rendererArtifact.manifest.buildId,
    expectedTarget: target,
    expectedRuntimeDirectory: paths.desktopRuntimeStagingRoot,
    requireArtifact: !args.includes("--dir"),
  });
  log(
    `[desktop-runtime] Packaged budget passed: Desktop renderer ${formatBytes(report.runtimeReport.rendererArtifactReport.bytes)}, Runtime child ${formatBytes(report.runtimeReport.runtimeArtifactReport.bytes)}, ${report.runtimeReport.fileCount} total files${report.artifactBytes === undefined ? "" : `, distribution ${formatBytes(report.artifactBytes)}`}. Runtime TS/test-shaped exceptions remain exactly manifest-owned Pi model-readable examples.`,
  );
  if (artifactOnly) {
    return Object.freeze({
      artifact: report,
      execution: "not-run",
      reason:
        packagedSmokeContract.execution === "required"
          ? "Explicit artifact-only mode skipped the otherwise-required native packaged-app execution smoke."
          : packagedSmokeContract.reason,
      type: ARTIFACT_ONLY_RESULT_TYPE,
    });
  }
  return report;
}

if (require.main === module) {
  void buildPackage()
    .then((result) => {
      if (result?.type === ARTIFACT_ONLY_RESULT_TYPE) {
        console.log(JSON.stringify(result));
      }
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = { ARTIFACT_ONLY_RESULT_TYPE, ARTIFACT_ONLY_ARGUMENT, buildPackage };
