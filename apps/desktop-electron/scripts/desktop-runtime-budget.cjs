const { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } = require("node:fs");
const path = require("node:path");

const { isArtifactTestShapedPath } = require("@workbench/host-artifact-policy/source-shape");
const {
  assertRuntimeArtifactModelReadableResourceClassification,
  collectRuntimeArtifactModelReadableResources,
  isRuntimeArtifactModelReadableException,
} = require("@workbench/host-artifact-policy/runtime-model-resources");

const {
  assertArtifactTreeEquivalent,
  assertRuntimeTreeEquivalent,
  snapshotArtifactTree,
  snapshotRuntimeTree,
} = require("./artifact-tree.cjs");

const { NATIVE_RUNTIME_PACKAGES } = require("./native-runtime.cjs");
const { resolveDesktopArtifactLayout } = require("./desktop-artifact-layout.cjs");
const { ELECTRON_RUNTIME_FILES } = require("./desktop-electron-files.cjs");
const { resolveDesktopRuntimeArtifact } = require("./runtime-artifact-admission.cjs");

const MEBIBYTE = 1024 * 1024;
const RUNTIME_EXTERNAL_PACKAGES = Object.freeze([
  "@earendil-works/pi-coding-agent",
  "node-pty",
  "tree-sitter",
  "tree-sitter-bash",
  "ws",
]);
const RUNTIME_DYNAMIC_PACKAGES = Object.freeze([
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
]);
const DESKTOP_RUNTIME_BUDGET = Object.freeze({
  maxAppBytes: 250 * MEBIBYTE,
  maxFileCount: 9_000,
  maxRendererArtifactBytes: 190 * MEBIBYTE,
  maxRendererArtifactFileCount: 5_500,
  maxRendererArtifactDependencyPackages: 0,
  maxRuntimeArtifactBytes: 120 * MEBIBYTE,
  maxRuntimeArtifactFileCount: 4_096 + 512,
  maxRuntimeArtifactDependencyPackages: 150,
  requiredRuntimeExternalPackages: RUNTIME_EXTERNAL_PACKAGES,
  requiredDynamicRuntimePackages: RUNTIME_DYNAMIC_PACKAGES,
  requiredNativeRuntimePackages: NATIVE_RUNTIME_PACKAGES,
});
const PACKAGED_OUTPUT_BUDGET = Object.freeze({
  maxArtifactBytes: 300 * MEBIBYTE,
});
const FORBIDDEN_RUNTIME_PACKAGES = new Set([
  "@electron/rebuild",
  "@vercel/nft",
  "electron",
  "electron-builder",
  "esbuild",
  "sharp",
  "tsx",
  "typescript",
]);
const TYPESCRIPT_SOURCE_PATTERN = /\.(?:[cm]?ts|tsx)$/iu;
const LOCKFILE_PATTERN =
  /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/u;

function isTestRuntimePath(relativePath) {
  return isArtifactTestShapedPath(relativePath);
}

function formatBytes(bytes) {
  return `${(bytes / MEBIBYTE).toFixed(1)} MiB`;
}

function isPathInside(rootDirectory, candidatePath) {
  const relative = path.relative(path.resolve(rootDirectory), path.resolve(candidatePath));
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function assertCanonicalDirectory(directory, label) {
  const stats = lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink() || realpathSync(directory) !== directory) {
    throw new Error(`${label} must be a canonical real directory.`);
  }
}

function assertCanonicalRegularFile(filePath, label) {
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || realpathSync(filePath) !== filePath) {
    throw new Error(`${label} must be a canonical regular file.`);
  }
}

function assertCanonicalStagedAppEnvelope(appRoot) {
  assertCanonicalDirectory(appRoot, "The staged app root");
  assertCanonicalRegularFile(path.join(appRoot, "package.json"), "The staged app package.json");
  assertCanonicalDirectory(path.join(appRoot, "electron"), "The staged Electron runtime root");
  assertCanonicalDirectory(path.join(appRoot, "public"), "The staged public resource root");
}

function packageIdentityFromManifest(manifest) {
  return typeof manifest.name === "string" && typeof manifest.version === "string"
    ? `${manifest.name}@${manifest.version}`
    : undefined;
}

function packageNameFromIdentity(identity) {
  return identity.slice(0, identity.lastIndexOf("@"));
}

function inspectTree(rootDirectory, { skipDirectories = [] } = {}) {
  const root = path.resolve(rootDirectory);
  const skipped = skipDirectories.map((item) => path.resolve(item));
  const report = {
    bytes: 0,
    brokenSymlinks: [],
    dependencyPackages: new Set(),
    fileCount: 0,
    files: [],
    lockfiles: [],
    sourceFiles: [],
    sourceMaps: [],
    testFiles: [],
  };
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (skipped.some((skip) => absolutePath === skip || isPathInside(skip, absolutePath))) {
        continue;
      }
      const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
      if (relativePath.endsWith(".map")) report.sourceMaps.push(relativePath);
      if (TYPESCRIPT_SOURCE_PATTERN.test(relativePath)) report.sourceFiles.push(relativePath);
      if (isTestRuntimePath(relativePath)) report.testFiles.push(relativePath);
      if (LOCKFILE_PATTERN.test(relativePath)) report.lockfiles.push(relativePath);
      const stats = lstatSync(absolutePath);
      if (stats.isSymbolicLink()) {
        if (!existsSync(absolutePath)) report.brokenSymlinks.push(relativePath);
        continue;
      }
      if (stats.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!stats.isFile()) continue;
      report.fileCount += 1;
      report.bytes += stats.size;
      report.files.push(relativePath);
      if (entry.name === "package.json" && relativePath.includes("node_modules/")) {
        try {
          const identity = packageIdentityFromManifest(
            JSON.parse(readFileSync(absolutePath, "utf8")),
          );
          if (identity) report.dependencyPackages.add(identity);
        } catch {
          // Exact artifact validation and Node loading own malformed package diagnostics. Keep the
          // budget traversal able to report independent source/link/size violations in one pass.
        }
      }
    }
  }
  visit(root);
  return Object.freeze({
    ...report,
    brokenSymlinks: Object.freeze(report.brokenSymlinks.sort()),
    dependencyPackages: Object.freeze([...report.dependencyPackages].sort()),
    files: Object.freeze(report.files.sort()),
    lockfiles: Object.freeze(report.lockfiles.sort()),
    sourceFiles: Object.freeze(report.sourceFiles.sort()),
    sourceMaps: Object.freeze(report.sourceMaps.sort()),
    testFiles: Object.freeze(report.testFiles.sort()),
  });
}

function mergeTreeReports(reports) {
  const dependencyPackages = new Set();
  const merged = {
    bytes: 0,
    brokenSymlinks: [],
    fileCount: 0,
    files: [],
    lockfiles: [],
    sourceFiles: [],
    sourceMaps: [],
    testFiles: [],
  };
  for (const { prefix, report } of reports) {
    merged.bytes += report.bytes;
    merged.fileCount += report.fileCount;
    for (const identity of report.dependencyPackages) dependencyPackages.add(identity);
    for (const key of [
      "brokenSymlinks",
      "files",
      "lockfiles",
      "sourceFiles",
      "sourceMaps",
      "testFiles",
    ]) {
      merged[key].push(...report[key].map((item) => `${prefix}${item}`));
    }
  }
  return Object.freeze({
    ...merged,
    brokenSymlinks: Object.freeze(merged.brokenSymlinks.sort()),
    dependencyPackages: Object.freeze([...dependencyPackages].sort()),
    files: Object.freeze(merged.files.sort()),
    lockfiles: Object.freeze(merged.lockfiles.sort()),
    sourceFiles: Object.freeze(merged.sourceFiles.sort()),
    sourceMaps: Object.freeze(merged.sourceMaps.sort()),
    testFiles: Object.freeze(merged.testFiles.sort()),
  });
}

function inspectDesktopRuntime(
  appDirectory,
  {
    runtimeArtifactDirectory,
    runtimeDirectory = path.join(appDirectory, "desktop-runtime"),
    rendererArtifactDirectory,
  } = {},
) {
  const appRoot = path.resolve(appDirectory);
  assertCanonicalStagedAppEnvelope(appRoot);
  const runtimeRoot = path.resolve(runtimeDirectory);
  const runtimeArtifactRoot = runtimeArtifactDirectory
    ? path.resolve(runtimeArtifactDirectory)
    : undefined;
  const rendererArtifactRoot = rendererArtifactDirectory
    ? path.resolve(rendererArtifactDirectory)
    : undefined;
  const appReport = inspectTree(appRoot);
  const total = isPathInside(appRoot, runtimeRoot)
    ? appReport
    : mergeTreeReports([
        { prefix: "", report: appReport },
        { prefix: "desktop-runtime/", report: inspectTree(runtimeRoot) },
      ]);
  const emptyReport = Object.freeze({
    bytes: 0,
    brokenSymlinks: Object.freeze([]),
    dependencyPackages: Object.freeze([]),
    fileCount: 0,
    files: Object.freeze([]),
    lockfiles: Object.freeze([]),
    sourceFiles: Object.freeze([]),
    sourceMaps: Object.freeze([]),
    testFiles: Object.freeze([]),
  });
  const rendererArtifactReport = rendererArtifactRoot
    ? inspectTree(rendererArtifactRoot)
    : emptyReport;
  const runtimeArtifactReport = runtimeArtifactRoot
    ? inspectTree(runtimeArtifactRoot)
    : emptyReport;
  return Object.freeze({
    appBytes: total.bytes,
    brokenSymlinks: total.brokenSymlinks,
    dependencyPackages: total.dependencyPackages,
    fileCount: total.fileCount,
    lockfiles: total.lockfiles,
    nodeModulesBytes: runtimeArtifactReport.bytes,
    rendererArtifactReport,
    runtimeArtifactReport,
    sourceFiles: total.sourceFiles,
    sourceMaps: total.sourceMaps,
    testFiles: total.testFiles,
    runtimeDirectory: runtimeRoot,
  });
}

function exactStringSet(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.every((item) => typeof item === "string") &&
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
  );
}

function pushReportViolations(report, label, limits, violations) {
  if (report.bytes > limits.maxBytes) {
    violations.push(
      `${label} size ${formatBytes(report.bytes)} exceeds ${formatBytes(limits.maxBytes)}`,
    );
  }
  if (report.fileCount > limits.maxFileCount) {
    violations.push(`${label} file count ${report.fileCount} exceeds ${limits.maxFileCount}`);
  }
  if (report.dependencyPackages.length > limits.maxDependencyPackages) {
    violations.push(
      `${label} dependency package count ${report.dependencyPackages.length} exceeds ${limits.maxDependencyPackages}`,
    );
  }
  if (report.sourceMaps.length > 0) {
    violations.push(`${label} source maps are present (${report.sourceMaps.length})`);
  }
  if (report.brokenSymlinks.length > 0) {
    violations.push(`${label} broken symlinks are present (${report.brokenSymlinks.length})`);
  }
  if (report.lockfiles.length > 0) {
    violations.push(
      `${label} package-manager lock/shrinkwrap files are present (${report.lockfiles.length})`,
    );
  }
}

function classifyRuntimeArtifactSources(artifact, report) {
  const expected = collectRuntimeArtifactModelReadableResources({
    artifactRoot: artifact.artifactRoot,
  });
  assertRuntimeArtifactModelReadableResourceClassification({
    resources: artifact.manifest.resources,
    modelReadableResources: artifact.manifest.modelReadableResources,
    expectedModelReadableResources: expected.resources,
    resolvedExamplesRoot: expected.resolvedExamplesRoot,
  });
  const forbiddenSources = [];
  const forbiddenTests = [];
  for (const relativePath of report.sourceFiles) {
    if (
      !isRuntimeArtifactModelReadableException(
        relativePath,
        artifact.manifest.modelReadableResources,
        expected.resolvedExamplesRoot,
      )
    ) {
      forbiddenSources.push(relativePath);
    }
  }
  for (const relativePath of report.testFiles) {
    if (
      !isRuntimeArtifactModelReadableException(
        relativePath,
        artifact.manifest.modelReadableResources,
        expected.resolvedExamplesRoot,
      )
    ) {
      forbiddenTests.push(relativePath);
    }
  }
  return Object.freeze({
    forbiddenSources: Object.freeze(forbiddenSources.sort()),
    forbiddenTests: Object.freeze(forbiddenTests.sort()),
    modelReadableResources: expected.resources,
    resolvedExamplesRoot: expected.resolvedExamplesRoot,
  });
}

async function assertDesktopRuntimeBudget(
  appDirectory,
  budget = DESKTOP_RUNTIME_BUDGET,
  {
    expectedRendererBuildId,
    expectedTarget,
    resolveArtifact = resolveDesktopRuntimeArtifact,
    resolveLayout = resolveDesktopArtifactLayout,
    resolveRenderer,
    runtimeDirectory = path.join(appDirectory, "desktop-runtime"),
  } = {},
) {
  const appRoot = path.resolve(appDirectory);
  const runtimeRoot = path.resolve(runtimeDirectory);
  const layout = await resolveLayout(runtimeRoot, {
    expectedRendererBuildId,
    expectedTarget,
    resolveRenderer,
    resolveRuntime: ({ manifestPath, expectedTarget: selectedTarget }) =>
      resolveArtifact({ manifestPath, expectedTarget: selectedTarget }),
  });
  const artifact = layout.runtime;
  const rendererArtifact = layout.renderer;
  const report = inspectDesktopRuntime(appRoot, {
    rendererArtifactDirectory: rendererArtifact.artifactRoot,
    runtimeArtifactDirectory: artifact.artifactRoot,
    runtimeDirectory: runtimeRoot,
  });
  const violations = [];
  const rootPackage = JSON.parse(readFileSync(path.join(appRoot, "package.json"), "utf8"));
  const runtimeIsNestedAtDefaultPath = runtimeRoot === path.join(appRoot, "desktop-runtime");
  const allowedAppEntries = new Set([
    ...(runtimeIsNestedAtDefaultPath ? ["desktop-runtime"] : []),
    "electron",
    "package.json",
    "public",
  ]);
  const allowedRuntimeEntries = new Set([
    "desktop-artifacts.json",
    "desktop-artifact-support.cjs",
    "desktop-renderer",
    "runtime-node",
  ]);
  const unexpectedAppEntries = readdirSync(appRoot).filter(
    (entry) => !allowedAppEntries.has(entry),
  );
  const unexpectedRuntimeEntries = readdirSync(runtimeRoot).filter(
    (entry) => !allowedRuntimeEntries.has(entry),
  );
  const runtimeTargetRoot = path.join(runtimeRoot, "runtime-node");
  const stagedTargetEntries = readdirSync(runtimeTargetRoot, {
    withFileTypes: true,
  });
  const electronDirectory = path.join(appRoot, "electron");
  const electronEntries = readdirSync(electronDirectory, { withFileTypes: true });
  const publicDirectory = path.join(appRoot, "public");
  const publicEntries = readdirSync(publicDirectory, { withFileTypes: true });

  if (Object.keys(rootPackage.dependencies ?? {}).length > 0) {
    violations.push("the staged Electron package must not declare production dependencies");
  }
  if (unexpectedAppEntries.length > 0) {
    violations.push(`unexpected staged app entries: ${unexpectedAppEntries.join(", ")}`);
  }
  if (unexpectedRuntimeEntries.length > 0) {
    violations.push(`unexpected desktop runtime entries: ${unexpectedRuntimeEntries.join(", ")}`);
  }
  if (
    JSON.stringify(electronEntries.map((entry) => entry.name).sort()) !==
      JSON.stringify([...ELECTRON_RUNTIME_FILES].sort()) ||
    electronEntries.some((entry) => !entry.isFile() || entry.isSymbolicLink())
  ) {
    violations.push("the staged Electron runtime file set is not exact");
  }
  if (
    publicEntries.length !== 1 ||
    publicEntries[0]?.name !== "app-icon.png" ||
    !publicEntries[0].isFile() ||
    publicEntries[0].isSymbolicLink()
  ) {
    violations.push("the staged Electron public resource set is not exact");
  }
  const stagedTargetEntry = stagedTargetEntries[0];
  const stagedTargetPath = stagedTargetEntry
    ? path.join(runtimeTargetRoot, stagedTargetEntry.name)
    : undefined;
  if (
    stagedTargetEntries.length !== 1 ||
    !stagedTargetEntry?.isDirectory() ||
    stagedTargetEntry.isSymbolicLink() ||
    realpathSync(stagedTargetPath) !== artifact.artifactRoot
  ) {
    violations.push("the staged desktop must contain exactly one manifest-selected Runtime target");
  }
  if (report.appBytes > budget.maxAppBytes) {
    violations.push(
      `app size ${formatBytes(report.appBytes)} exceeds ${formatBytes(budget.maxAppBytes)}`,
    );
  }
  if (report.fileCount > budget.maxFileCount) {
    violations.push(`app file count ${report.fileCount} exceeds ${budget.maxFileCount}`);
  }
  pushReportViolations(
    report.rendererArtifactReport,
    "Desktop renderer artifact",
    {
      maxBytes: budget.maxRendererArtifactBytes,
      maxFileCount: budget.maxRendererArtifactFileCount,
      maxDependencyPackages: budget.maxRendererArtifactDependencyPackages,
    },
    violations,
  );
  pushReportViolations(
    report.runtimeArtifactReport,
    "Runtime artifact",
    {
      maxBytes: budget.maxRuntimeArtifactBytes,
      maxFileCount: budget.maxRuntimeArtifactFileCount,
      maxDependencyPackages: budget.maxRuntimeArtifactDependencyPackages,
    },
    violations,
  );
  if (report.rendererArtifactReport.sourceFiles.length > 0) {
    violations.push(
      `Desktop renderer TypeScript source files are present (${report.rendererArtifactReport.sourceFiles.length})`,
    );
  }
  if (report.rendererArtifactReport.testFiles.length > 0) {
    violations.push(
      `Desktop renderer test or fixture files are present (${report.rendererArtifactReport.testFiles.length})`,
    );
  }
  if (!exactStringSet(artifact.manifest.externalPackages, budget.requiredRuntimeExternalPackages)) {
    violations.push("Runtime artifact external package set changed");
  }
  if (!exactStringSet(artifact.manifest.dynamicPackages, budget.requiredDynamicRuntimePackages)) {
    violations.push("Runtime artifact dynamic package set changed");
  }
  if (!exactStringSet(artifact.manifest.nativePackages, budget.requiredNativeRuntimePackages)) {
    violations.push("Runtime artifact native package set changed");
  }
  const buildOnlyPackages = report.dependencyPackages.filter((identity) =>
    FORBIDDEN_RUNTIME_PACKAGES.has(packageNameFromIdentity(identity)),
  );
  if (buildOnlyPackages.length > 0) {
    violations.push(`build-only packages entered the staged app: ${buildOnlyPackages.join(", ")}`);
  }

  const sourceClassification = classifyRuntimeArtifactSources(
    artifact,
    report.runtimeArtifactReport,
  );
  if (sourceClassification.forbiddenSources.length > 0) {
    violations.push(
      `Runtime artifact has TypeScript outside manifest-owned Pi examples (${sourceClassification.forbiddenSources.length})`,
    );
  }
  if (sourceClassification.forbiddenTests.length > 0) {
    violations.push(
      `Runtime artifact has test-shaped files outside manifest-owned Pi examples (${sourceClassification.forbiddenTests.length})`,
    );
  }
  if (violations.length > 0) {
    throw new Error(
      ["Desktop runtime budget failed:", ...violations.map((violation) => `- ${violation}`)].join(
        "\n",
      ),
    );
  }
  return Object.freeze({
    ...report,
    layout,
    rendererArtifact,
    runtimeArtifact: artifact,
    // Pi exposes these manifest-owned examples as model-readable SDK documentation/resources.
    // They may be TS/test-shaped, but are not auto-admitted by startup, NFT, or a dynamic loader.
    modelReadableResources: sourceClassification.modelReadableResources,
  });
}

function findPackagedDesktopLayouts(outputDirectory, maxDepth = 6) {
  const results = [];
  function visit(directory, depth) {
    if (existsSync(path.join(directory, "desktop-runtime", "desktop-artifacts.json"))) {
      const splitAppDirectory = path.join(directory, "app");
      if (existsSync(path.join(splitAppDirectory, "package.json"))) {
        results.push(
          Object.freeze({
            appDirectory: splitAppDirectory,
            runtimeDirectory: path.join(directory, "desktop-runtime"),
          }),
        );
      } else if (existsSync(path.join(directory, "package.json"))) {
        results.push(
          Object.freeze({
            appDirectory: directory,
            runtimeDirectory: path.join(directory, "desktop-runtime"),
          }),
        );
      }
      return;
    }
    if (depth >= maxDepth) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(path.join(directory, entry.name), depth + 1);
    }
  }
  visit(path.resolve(outputDirectory), 0);
  return results;
}

function findPackagedAppDirectories(outputDirectory, maxDepth = 6) {
  return findPackagedDesktopLayouts(outputDirectory, maxDepth).map((layout) => layout.appDirectory);
}

async function assertPackagedOutputBudget(
  outputDirectory,
  {
    expectedRendererBuildId,
    expectedTarget,
    expectedRuntimeDirectory,
    requireArtifact = false,
    resolveArtifact = resolveDesktopRuntimeArtifact,
    resolveLayout = resolveDesktopArtifactLayout,
    resolveRenderer,
    runtimeBudget = DESKTOP_RUNTIME_BUDGET,
  } = {},
) {
  const layouts = findPackagedDesktopLayouts(outputDirectory);
  if (layouts.length === 0) {
    throw new Error(`No packaged desktop app was found under ${outputDirectory}.`);
  }
  const layout = layouts.sort(
    (left, right) =>
      lstatSync(right.runtimeDirectory).mtimeMs - lstatSync(left.runtimeDirectory).mtimeMs,
  )[0];
  const { appDirectory, runtimeDirectory } = layout;
  if (expectedRuntimeDirectory) {
    assertRuntimeTreeEquivalent(expectedRuntimeDirectory, runtimeDirectory);
  }
  const runtimeReport = await assertDesktopRuntimeBudget(appDirectory, runtimeBudget, {
    expectedRendererBuildId,
    expectedTarget,
    resolveArtifact,
    resolveLayout,
    resolveRenderer,
    runtimeDirectory,
  });
  const artifactPattern = /\.(?:deb|dmg|exe|zip)$/iu;
  const artifacts = readdirSync(outputDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && artifactPattern.test(entry.name))
    .map((entry) => {
      const artifactPath = path.join(outputDirectory, entry.name);
      return { path: artifactPath, stats: lstatSync(artifactPath) };
    })
    .sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs);
  if (requireArtifact && artifacts.length === 0) {
    throw new Error(`No desktop distribution artifact was found under ${outputDirectory}.`);
  }
  const packagedArtifact = requireArtifact ? artifacts[0] : undefined;
  if (packagedArtifact && packagedArtifact.stats.size > PACKAGED_OUTPUT_BUDGET.maxArtifactBytes) {
    throw new Error(
      `Desktop artifact ${path.basename(packagedArtifact.path)} is ${formatBytes(packagedArtifact.stats.size)}; budget is ${formatBytes(PACKAGED_OUTPUT_BUDGET.maxArtifactBytes)}.`,
    );
  }
  return Object.freeze({
    appDirectory,
    artifactBytes: packagedArtifact?.stats.size,
    artifactPath: packagedArtifact?.path,
    runtimeDirectory,
    runtimeReport,
  });
}

module.exports = {
  DESKTOP_RUNTIME_BUDGET,
  FORBIDDEN_RUNTIME_PACKAGES,
  PACKAGED_OUTPUT_BUDGET,
  RUNTIME_DYNAMIC_PACKAGES,
  RUNTIME_EXTERNAL_PACKAGES,
  assertArtifactTreeEquivalent,
  assertDesktopRuntimeBudget,
  assertPackagedOutputBudget,
  assertRuntimeTreeEquivalent,
  classifyRuntimeArtifactSources,
  findPackagedAppDirectories,
  findPackagedDesktopLayouts,
  formatBytes,
  inspectDesktopRuntime,
  inspectTree,
  isTestRuntimePath,
  snapshotArtifactTree,
  snapshotRuntimeTree,
};
