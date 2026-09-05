require("tsx/cjs");

const {
  copyFileSync,
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { isBuiltin } = require("node:module");
const path = require("node:path");

const { build } = require("esbuild");
const { createWorkbenchPaths } = require("../../../scripts/workbench-paths.cjs");
const { assertArtifactTreeEquivalent } = require("./artifact-tree.cjs");
const {
  createDesktopArtifactComposition,
  resolveDesktopArtifactLayout,
} = require("./desktop-artifact-layout.cjs");
const { ELECTRON_RUNTIME_FILES } = require("./desktop-electron-files.cjs");
const { assertDesktopRuntimeBudget, formatBytes } = require("./desktop-runtime-budget.cjs");
const { assertExactTarget, resolveNativeTarget } = require("./native-runtime.cjs");
const {
  resolveDesktopRendererArtifact,
  stageDesktopRendererArtifact,
} = require("./desktop-renderer-artifact.cjs");
const { resolveDesktopRuntimeArtifact } = require("./runtime-artifact-admission.cjs");

function lstatIfPresent(candidate) {
  try {
    return lstatSync(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function resetElectronStaging(paths) {
  const expected = path.join(paths.repositoryRoot, ".electron-build");
  if (paths.stagingRoot !== expected || !path.isAbsolute(paths.stagingRoot)) {
    throw new Error(
      `Refusing to replace an unexpected Electron staging root: ${paths.stagingRoot}.`,
    );
  }
  const parent = path.dirname(paths.stagingRoot);
  if (realpathSync(parent) !== parent) {
    throw new Error("Refusing to replace Electron staging through an aliased parent.");
  }
  const stats = lstatIfPresent(paths.stagingRoot);
  if (stats?.isSymbolicLink()) {
    throw new Error("Refusing to replace a symlinked Electron staging root.");
  }
  if (stats && realpathSync(paths.stagingRoot) !== paths.stagingRoot) {
    throw new Error("Refusing to replace an aliased Electron staging root.");
  }
  rmSync(paths.stagingRoot, { force: true, recursive: true });
  mkdirSync(paths.desktopRuntimeStagingRoot, { recursive: true });
}

function copyRegularFile(sourcePath, destinationPath, label) {
  const stats = lstatSync(sourcePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular source file.`);
  }
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  copyFileSync(sourcePath, destinationPath);
}

function writeMinimalPackageFile(projectPackage, paths) {
  if (
    typeof projectPackage.desktopPackageName !== "string" ||
    !projectPackage.desktopPackageName.trim()
  ) {
    throw new Error("The Electron app manifest must declare desktopPackageName.");
  }
  writeFileSync(
    path.join(paths.electronAppStagingRoot, "package.json"),
    `${JSON.stringify(
      {
        name: projectPackage.desktopPackageName,
        version: projectPackage.version,
        private: true,
        license: projectPackage.license,
        main: "electron/main.cjs",
        productName: projectPackage.productName,
        desktopName: projectPackage.desktopName,
      },
      null,
      2,
    )}\n`,
  );
}

function createDesktopArtifactSupportBuildOptions({ paths, outfile }) {
  return {
    absWorkingDir: paths.repositoryRoot,
    bundle: true,
    entryPoints: [path.join(paths.desktopElectronScriptsRoot, "desktop-artifact-support.cjs")],
    format: "cjs",
    legalComments: "none",
    metafile: true,
    outfile,
    platform: "node",
    sourcemap: false,
    target: "node22",
  };
}

const PACKAGED_MAIN_LOCAL_EXTERNALS = Object.freeze([
  "desktop-services.cjs",
  "desktop-renderer-protocol.cjs",
  "packaged-runtime-lifecycle.cjs",
  "runtime-artifact-environment.cjs",
  "title-bar-overlay.cjs",
]);

function packagedMainLocalRuntimePlugin() {
  return {
    name: "packaged-main-local-runtime",
    setup(buildContext) {
      buildContext.onResolve({ filter: /^\.\// }, ({ path: specifier }) => ({
        external: true,
        path: specifier,
      }));
    },
  };
}

function createPackagedMainBuildOptions({ paths, outfile }) {
  return {
    absWorkingDir: paths.repositoryRoot,
    bundle: true,
    entryPoints: [path.join(paths.desktopElectronSourceRoot, "main.cjs")],
    external: ["electron"],
    format: "cjs",
    legalComments: "none",
    metafile: true,
    outfile,
    platform: "node",
    plugins: [packagedMainLocalRuntimePlugin()],
    sourcemap: false,
    target: "node22",
  };
}

function createServerProcessLifecycleBuildOptions({ paths, outfile }) {
  return {
    absWorkingDir: paths.repositoryRoot,
    bundle: true,
    entryPoints: [path.join(paths.desktopElectronSourceRoot, "server-process-lifecycle.cjs")],
    format: "cjs",
    legalComments: "none",
    metafile: true,
    outfile,
    platform: "node",
    sourcemap: false,
    target: "node22",
  };
}

function createPackagedPreloadBuildOptions({ paths, outfile }) {
  return {
    absWorkingDir: paths.repositoryRoot,
    bundle: true,
    entryPoints: [path.join(paths.desktopElectronSourceRoot, "preload.cjs")],
    external: ["electron"],
    format: "cjs",
    legalComments: "none",
    metafile: true,
    outfile,
    platform: "node",
    sourcemap: false,
    target: "es2022",
  };
}

function assertDesktopArtifactSupportBuild(result) {
  const externalImports = Object.values(result.metafile.outputs)
    .flatMap((output) => output.imports)
    .filter((item) => item.external)
    .map((item) => item.path)
    .filter((specifier) => !isBuiltin(specifier));
  if (externalImports.length > 0) {
    throw new Error(
      `The packaged desktop artifact support retained non-builtin imports: ${[...new Set(externalImports)].sort().join(", ")}.`,
    );
  }
  const forbiddenInputs = Object.keys(result.metafile.inputs).filter((input) => {
    const normalizedInput = input.replaceAll("\\", "/");
    return (
      normalizedInput.includes("node_modules/tsx/") ||
      normalizedInput.endsWith("apps/desktop-electron/scripts/native-runtime.cjs") ||
      normalizedInput.includes("apps/runtime-node/") ||
      normalizedInput.includes("apps/web/src/")
    );
  });
  if (forbiddenInputs.length > 0) {
    throw new Error(
      `The packaged desktop artifact support captured source/build-only ownership: ${forbiddenInputs.sort().join(", ")}.`,
    );
  }
}

function assertServerProcessLifecycleBuild(result) {
  const externalImports = Object.values(result.metafile.outputs)
    .flatMap((output) => output.imports)
    .filter((item) => item.external)
    .map((item) => item.path)
    .filter((specifier) => !isBuiltin(specifier));
  if (externalImports.length > 0) {
    throw new Error(
      `The packaged server-process lifecycle retained non-builtin imports: ${[...new Set(externalImports)].sort().join(", ")}.`,
    );
  }
  const forbiddenInputs = Object.keys(result.metafile.inputs).filter((input) => {
    const normalizedInput = input.replaceAll("\\", "/");
    return (
      normalizedInput.includes("node_modules/tsx/") ||
      normalizedInput.includes("apps/runtime-node/") ||
      normalizedInput.includes("apps/web/src/")
    );
  });
  if (forbiddenInputs.length > 0) {
    throw new Error(
      `The packaged server-process lifecycle captured source/build-only ownership: ${forbiddenInputs.sort().join(", ")}.`,
    );
  }
}

function assertPackagedMainBuild(result) {
  const externalImports = Object.values(result.metafile.outputs)
    .flatMap((output) => output.imports)
    .filter((item) => item.external)
    .map((item) => item.path)
    .filter((specifier) => !isBuiltin(specifier))
    .sort();
  const expectedExternalImports = [
    "electron",
    ...PACKAGED_MAIN_LOCAL_EXTERNALS.map((file) => `./${file}`),
  ].sort();
  if (JSON.stringify(externalImports) !== JSON.stringify(expectedExternalImports)) {
    throw new Error(
      `The packaged Electron main retained unexpected non-builtin imports: ${[...new Set(externalImports)].join(", ") || "none"}.`,
    );
  }
  const normalizedInputs = Object.keys(result.metafile.inputs)
    .map((input) => input.replaceAll("\\", "/"))
    .sort();
  const expectedSuffixes = ["apps/desktop-electron/src/main.cjs"];
  if (
    normalizedInputs.length !== expectedSuffixes.length ||
    expectedSuffixes.some((suffix) => !normalizedInputs.some((input) => input.endsWith(suffix)))
  ) {
    throw new Error(
      `The packaged Electron main captured an unexpected probe source closure: ${normalizedInputs.join(", ")}.`,
    );
  }
}

function assertPackagedPreloadBuild(result) {
  const externalImports = Object.values(result.metafile.outputs)
    .flatMap((output) => output.imports)
    .filter((item) => item.external)
    .map((item) => item.path);
  if (externalImports.length !== 1 || externalImports[0] !== "electron") {
    throw new Error(
      `The packaged preload must retain only its sandbox-provided Electron import: ${[...new Set(externalImports)].sort().join(", ") || "none"}.`,
    );
  }
  const normalizedInputs = Object.keys(result.metafile.inputs)
    .map((input) => input.replaceAll("\\", "/"))
    .sort();
  const expectedSuffixes = ["apps/desktop-electron/src/preload.cjs"];
  if (
    normalizedInputs.length !== expectedSuffixes.length ||
    expectedSuffixes.some((suffix) => !normalizedInputs.some((input) => input.endsWith(suffix)))
  ) {
    throw new Error(
      `The packaged preload captured an unexpected source closure: ${normalizedInputs.join(", ")}.`,
    );
  }
}

async function buildDesktopArtifactSupport({ paths, outfile, buildImpl = build } = {}) {
  const options = createDesktopArtifactSupportBuildOptions({ paths, outfile });
  const result = await buildImpl(options);
  assertDesktopArtifactSupportBuild(result);
  const stats = lstatSync(outfile);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("The packaged desktop artifact support was not emitted as a regular file.");
  }
  return Object.freeze({ outfile, result });
}

async function buildServerProcessLifecycle({ paths, outfile, buildImpl = build } = {}) {
  const options = createServerProcessLifecycleBuildOptions({ paths, outfile });
  const result = await buildImpl(options);
  assertServerProcessLifecycleBuild(result);
  const stats = lstatSync(outfile);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("The packaged server-process lifecycle was not emitted as a regular file.");
  }
  return Object.freeze({ outfile, result });
}

async function buildDesktopServices({ paths, outfile, buildImpl = build } = {}) {
  const result = await buildImpl({
    absWorkingDir: paths.repositoryRoot,
    bundle: true,
    entryPoints: [path.join(paths.desktopElectronSourceRoot, "desktop-services.cjs")],
    external: ["electron"],
    format: "cjs",
    platform: "node",
    target: "node24",
    metafile: true,
    outfile,
  });
  const imports = Object.values(result.metafile.outputs)
    .flatMap((output) => output.imports)
    .filter((item) => item.external && !isBuiltin(item.path));
  if (imports.some((item) => item.path !== "electron"))
    throw new Error("Desktop services retained an unbundled dependency.");
}

async function buildPackagedMain({ paths, outfile, buildImpl = build } = {}) {
  const options = createPackagedMainBuildOptions({ paths, outfile });
  const result = await buildImpl(options);
  assertPackagedMainBuild(result);
  const stats = lstatSync(outfile);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("The packaged Electron main was not emitted as a regular file.");
  }
  return Object.freeze({ outfile, result });
}

async function buildPackagedPreload({ paths, outfile, buildImpl = build } = {}) {
  const options = createPackagedPreloadBuildOptions({ paths, outfile });
  const result = await buildImpl(options);
  assertPackagedPreloadBuild(result);
  const stats = lstatSync(outfile);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("The packaged preload was not emitted as a regular file.");
  }
  return Object.freeze({ outfile, result });
}

async function stageRuntimeArtifact({
  sourceArtifact,
  destinationRoot,
  target,
  resolveArtifact = resolveDesktopRuntimeArtifact,
} = {}) {
  if (!sourceArtifact?.artifactRoot) {
    throw new Error("A validated source Runtime artifact is required for Electron staging.");
  }
  const verifiedSource = await resolveArtifact({
    artifactRoot: sourceArtifact.artifactRoot,
    expectedTarget: target,
  });
  assertExactTarget(verifiedSource.manifest.target, target);
  const destinationParent = path.dirname(path.resolve(destinationRoot));
  if (realpathSync(destinationParent) !== destinationParent) {
    throw new Error("The Runtime artifact staging parent must be canonical.");
  }
  if (lstatIfPresent(destinationRoot)) {
    throw new Error("The Runtime artifact staging root must not exist before staging.");
  }
  mkdirSync(destinationRoot, { recursive: true });
  const destination = path.join(destinationRoot, path.basename(verifiedSource.artifactRoot));
  cpSync(verifiedSource.artifactRoot, destination, {
    dereference: false,
    preserveTimestamps: true,
    recursive: true,
    verbatimSymlinks: true,
  });
  const staged = await resolveArtifact({ artifactRoot: destination, expectedTarget: target });
  assertExactTarget(staged.manifest.target, target);
  assertArtifactTreeEquivalent(verifiedSource.artifactRoot, staged.artifactRoot, {
    expectedLabel: "source Runtime artifact",
    actualLabel: "staged Runtime artifact",
  });
  return staged;
}

function writeStagedDesktopComposition(paths, rendererArtifact, runtimeArtifact) {
  const composition = createDesktopArtifactComposition({
    runtimeRoot: paths.desktopRuntimeStagingRoot,
    rendererManifestPath: rendererArtifact.manifestPath,
    runtimeManifestPath: runtimeArtifact.manifestPath,
  });
  writeFileSync(paths.desktopArtifactCompositionPath, `${JSON.stringify(composition, null, 2)}\n`);
  return composition;
}

async function preparePackage({
  paths = createWorkbenchPaths(),
  target,
  runtimeArtifact,
  resolveTarget = resolveNativeTarget,
  resolveArtifact = resolveDesktopRuntimeArtifact,
  resolveRenderer = resolveDesktopRendererArtifact,
  resolveLayout = resolveDesktopArtifactLayout,
  assertBudget = assertDesktopRuntimeBudget,
  stageArtifact = stageRuntimeArtifact,
  stageRenderer = stageDesktopRendererArtifact,
  buildSupport = buildDesktopArtifactSupport,
  buildMain = buildPackagedMain,
  buildServices = buildDesktopServices,
  buildPreload = buildPackagedPreload,
  buildProcessLifecycle = buildServerProcessLifecycle,
  log = console.log,
} = {}) {
  const electronTarget =
    target ??
    resolveTarget([], {
      expectedAppDirectory: paths.electronAppStagingRoot,
      expectedOutputDirectory: paths.electronOutputRoot,
      projectRoot: paths.desktopElectronRoot,
      repositoryRoot: paths.repositoryRoot,
    });
  const sourceRendererArtifact = resolveRenderer({
    manifestPath: paths.desktopRendererArtifactManifestPath,
  });
  const sourceRuntimeArtifact =
    runtimeArtifact ??
    (await resolveArtifact({
      artifactRoot: paths.runtimeArtifactRoot,
      expectedTarget: electronTarget,
    }));
  assertExactTarget(sourceRuntimeArtifact.manifest.target, electronTarget);
  const projectPackage = JSON.parse(
    readFileSync(path.join(paths.desktopElectronRoot, "package.json"), "utf8"),
  );

  resetElectronStaging(paths);
  const stagedRendererArtifact = await stageRenderer({
    sourceArtifact: sourceRendererArtifact,
    destinationRoot: paths.desktopRendererArtifactStagingRoot,
    expectedBuildId: sourceRendererArtifact.manifest.buildId,
  });
  const stagedRuntimeArtifact = await stageArtifact({
    sourceArtifact: sourceRuntimeArtifact,
    destinationRoot: paths.desktopRuntimeArtifactStagingRoot,
    target: electronTarget,
    resolveArtifact,
  });
  await buildSupport({
    paths,
    outfile: path.join(paths.desktopRuntimeStagingRoot, "desktop-artifact-support.cjs"),
  });
  writeStagedDesktopComposition(paths, stagedRendererArtifact, stagedRuntimeArtifact);

  for (const file of ELECTRON_RUNTIME_FILES) {
    if (
      ["main.cjs", "preload.cjs", "server-process-lifecycle.cjs", "desktop-services.cjs"].includes(
        file,
      )
    )
      continue;
    copyRegularFile(
      path.join(paths.desktopElectronSourceRoot, file),
      path.join(paths.electronAppStagingRoot, "electron", file),
      `Electron runtime file ${file}`,
    );
  }
  await buildServices({
    paths,
    outfile: path.join(paths.electronAppStagingRoot, "electron", "desktop-services.cjs"),
  });
  await buildMain({
    paths,
    outfile: path.join(paths.electronAppStagingRoot, "electron", "main.cjs"),
  });
  await buildPreload({
    paths,
    outfile: path.join(paths.electronAppStagingRoot, "electron", "preload.cjs"),
  });
  await buildProcessLifecycle({
    paths,
    outfile: path.join(paths.electronAppStagingRoot, "electron", "server-process-lifecycle.cjs"),
  });
  const iconRelativePath = "app-icon.svg";
  if (!stagedRendererArtifact.manifest.files.some((file) => file.path === iconRelativePath)) {
    throw new Error("The Desktop renderer artifact does not own the Electron icon resource.");
  }
  copyRegularFile(
    path.join(stagedRendererArtifact.artifactRoot, iconRelativePath),
    path.join(paths.electronAppStagingRoot, "public", iconRelativePath),
    "Electron window icon",
  );
  writeMinimalPackageFile(projectPackage, paths);

  const layout = await resolveLayout(paths.desktopRuntimeStagingRoot, {
    expectedTarget: electronTarget,
    expectedRendererBuildId: stagedRendererArtifact.manifest.buildId,
    resolveRenderer,
    resolveRuntime: ({ manifestPath, expectedTarget }) =>
      resolveArtifact({ manifestPath, expectedTarget }),
  });
  const report = await assertBudget(paths.electronAppStagingRoot, undefined, {
    expectedTarget: electronTarget,
    expectedRendererBuildId: stagedRendererArtifact.manifest.buildId,
    resolveArtifact,
    resolveRenderer,
  });
  log(
    `[desktop-runtime] Staged Desktop renderer ${formatBytes(report.rendererArtifactReport.bytes)} and Electron Runtime artifact ${formatBytes(report.runtimeArtifactReport.bytes)} (${report.fileCount} total files).`,
  );
  return Object.freeze({
    layout,
    report,
    rendererArtifact: stagedRendererArtifact,
    runtimeArtifact: stagedRuntimeArtifact,
  });
}

if (require.main === module) {
  void preparePackage().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  assertPackagedMainBuild,
  assertPackagedPreloadBuild,
  assertDesktopArtifactSupportBuild,
  assertServerProcessLifecycleBuild,
  buildPackagedMain,
  buildDesktopServices,
  buildPackagedPreload,
  buildDesktopArtifactSupport,
  buildServerProcessLifecycle,
  createPackagedMainBuildOptions,
  createPackagedPreloadBuildOptions,
  createDesktopArtifactSupportBuildOptions,
  createServerProcessLifecycleBuildOptions,
  preparePackage,
  resetElectronStaging,
  stageRuntimeArtifact,
  writeStagedDesktopComposition,
};
