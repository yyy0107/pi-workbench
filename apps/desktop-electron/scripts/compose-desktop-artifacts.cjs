require("tsx/cjs");

const { mkdirSync, renameSync, rmSync, writeFileSync } = require("node:fs");

const { createWorkbenchPaths } = require("../../../scripts/workbench-paths.cjs");
const {
  createDesktopArtifactComposition,
  readDesktopArtifactComposition,
} = require("./desktop-artifact-layout.cjs");
const { resolveDesktopRendererArtifact } = require("./desktop-renderer-artifact.cjs");
const { resolveDesktopRuntimeArtifact } = require("./runtime-artifact-admission.cjs");
const { resolveInstalledElectronTarget } = require("./native-runtime.cjs");

function writeDesktopArtifactComposition({ paths, rendererArtifact, runtimeArtifact }) {
  const runtimeRoot = paths.desktopArtifactBuildRoot;
  const composition = createDesktopArtifactComposition({
    runtimeRoot,
    rendererManifestPath: rendererArtifact.manifestPath,
    runtimeManifestPath: runtimeArtifact.manifestPath,
  });
  mkdirSync(runtimeRoot, { recursive: true });
  const compositionPath = paths.desktopArtifactCompositionSourcePath;
  const temporaryPath = `${compositionPath}.tmp-${process.pid}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(composition, null, 2)}\n`, { flag: "wx" });
    renameSync(temporaryPath, compositionPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  const written = readDesktopArtifactComposition(runtimeRoot);
  if (JSON.stringify(written.manifest) !== JSON.stringify(composition)) {
    throw new Error("The written desktop artifact composition changed during publication.");
  }
  return written;
}

async function composeDesktopArtifacts({
  paths = createWorkbenchPaths(),
  resolveRuntime = resolveDesktopRuntimeArtifact,
  resolveRenderer = resolveDesktopRendererArtifact,
  resolveTarget = resolveInstalledElectronTarget,
  buildSupport,
  log = console.log,
} = {}) {
  const rendererArtifact = resolveRenderer({
    manifestPath: paths.desktopRendererArtifactManifestPath,
  });
  const expectedTarget = resolveTarget();
  const runtimeArtifact = await resolveRuntime({
    artifactRoot: paths.runtimeArtifactRoot,
    expectedTarget,
  });
  await (buildSupport ?? require("./prepare-package.cjs").buildDesktopArtifactSupport)({
    paths,
    outfile: require("node:path").join(
      paths.desktopArtifactBuildRoot,
      "desktop-artifact-support.cjs",
    ),
  });
  const written = writeDesktopArtifactComposition({
    paths,
    rendererArtifact,
    runtimeArtifact,
  });
  log(
    `[desktop-runtime] Composed Desktop renderer ${rendererArtifact.manifest.buildId} with Runtime target ${runtimeArtifact.manifest.target.targetTriple}.`,
  );
  return Object.freeze({
    composition: written.manifest,
    compositionPath: written.manifestPath,
    rendererArtifact,
    runtimeArtifact,
  });
}

if (require.main === module) {
  void composeDesktopArtifacts().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  composeDesktopArtifacts,
  writeDesktopArtifactComposition,
};
