require("tsx/cjs");

const { cpSync, existsSync, lstatSync, realpathSync, rmSync } = require("node:fs");
const path = require("node:path");

const { assertArtifactTreeEquivalent } = require("./artifact-tree.cjs");
const { resolveDesktopArtifactLayout } = require("./desktop-artifact-layout.cjs");
const { resolveInstalledElectronTarget } = require("./native-runtime.cjs");

function isPathInside(rootDirectory, candidatePath) {
  const relative = path.relative(path.resolve(rootDirectory), path.resolve(candidatePath));
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

async function materializeDesktopRuntime(
  context,
  {
    copy = cpSync,
    remove = rmSync,
    resolveLayout = resolveDesktopArtifactLayout,
    resolveTarget = resolveInstalledElectronTarget,
    sourceDirectory,
    target,
  } = {},
) {
  const rawAppOutDirectory = context?.appOutDir;
  const rawAppDirectory = context?.packager?.info?.appDir;
  const getResourcesDirectory = context?.packager?.getResourcesDir;
  if (
    typeof rawAppOutDirectory !== "string" ||
    !rawAppOutDirectory ||
    typeof rawAppDirectory !== "string" ||
    !rawAppDirectory ||
    typeof getResourcesDirectory !== "function"
  ) {
    throw new Error(
      "Electron afterPack context cannot resolve the staged app and Resources roots.",
    );
  }
  const appOutDirectory = path.resolve(rawAppOutDirectory);
  const appDirectory = path.resolve(rawAppDirectory);
  const resourcesDirectory = path.resolve(
    getResourcesDirectory.call(context.packager, appOutDirectory),
  );
  if (
    !isPathInside(appOutDirectory, resourcesDirectory) ||
    !isPathInside(realpathSync(appOutDirectory), realpathSync(resourcesDirectory))
  ) {
    throw new Error("Electron Resources directory escapes appOutDir.");
  }

  const source = path.resolve(sourceDirectory ?? path.join(appDirectory, "desktop-runtime"));
  if (
    !existsSync(source) ||
    !lstatSync(source).isDirectory() ||
    !existsSync(path.join(source, "desktop-artifacts.json"))
  ) {
    throw new Error(`Missing curated staged desktop-runtime: ${source}`);
  }
  if (
    !isPathInside(appDirectory, source) ||
    !isPathInside(realpathSync(appDirectory), realpathSync(source))
  ) {
    throw new Error("Curated staged desktop-runtime escapes the Electron app staging root.");
  }

  const destination = path.join(resourcesDirectory, "desktop-runtime");
  if (!isPathInside(resourcesDirectory, destination)) {
    throw new Error("Packaged desktop-runtime destination escapes Resources.");
  }
  const expectedTarget = target ?? resolveTarget();
  const sourceLayout = await resolveLayout(source, { expectedTarget });
  remove(destination, { force: true, recursive: true });
  copy(source, destination, {
    preserveTimestamps: true,
    recursive: true,
    verbatimSymlinks: true,
  });
  const packagedLayout = await resolveLayout(destination, {
    expectedTarget,
    expectedRendererBuildId: sourceLayout.renderer.manifest.buildId,
  });
  assertArtifactTreeEquivalent(source, destination, {
    expectedLabel: "staged desktop-runtime",
    actualLabel: "packaged desktop-runtime",
  });
  return Object.freeze({ destination, packagedLayout, source, sourceLayout });
}

async function afterPack(context) {
  await materializeDesktopRuntime(context);
}

module.exports = afterPack;
module.exports.materializeDesktopRuntime = materializeDesktopRuntime;
