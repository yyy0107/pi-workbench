const {
  cpSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
} = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");

const { createWorkbenchPaths } = require("../../../scripts/workbench-paths.cjs");
const {
  resolveWebArtifactNextWebpackRuntime,
} = require("@workbench/host-artifact-policy/web-next-runtime-exception");

const REQUIRED_HELPER_FILES = Object.freeze([
  "cjs/_interop_require_default.cjs",
  "esm/_interop_require_default.js",
  "package.json",
]);
const REQUIRED_TSLIB_FILES = Object.freeze(["package.json", "tslib.js"]);

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function packageIdentity(manifestPath, label) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`${label} manifest is unreadable: ${manifestPath}`, { cause: error });
  }
  if (
    !manifest ||
    typeof manifest !== "object" ||
    typeof manifest.name !== "string" ||
    typeof manifest.version !== "string"
  ) {
    throw new Error(`${label} manifest has no package name/version: ${manifestPath}`);
  }
  return Object.freeze({ name: manifest.name, version: manifest.version });
}

function confinedRealpath(root, candidate, label) {
  let resolved;
  try {
    resolved = realpathSync(candidate);
  } catch (error) {
    throw new Error(`${label} is missing or cannot be resolved: ${candidate}`, { cause: error });
  }
  if (!isInside(root, resolved)) {
    throw new Error(`${label} escapes the selected standalone root: ${candidate}`);
  }
  return resolved;
}

function existingEntry(filePath) {
  try {
    return lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function validateDestinationParent(root, destination, label) {
  const parent = confinedRealpath(root, path.dirname(destination), `${label} parent`);
  if (!isInside(parent, path.resolve(destination))) {
    throw new Error(`${label} is not a direct child of its confined parent: ${destination}`);
  }
  return parent;
}

function validateReplacementDestination(root, destination, label) {
  const parent = validateDestinationParent(root, destination, label);
  if (existingEntry(destination)) confinedRealpath(root, destination, label);
  return parent;
}

function standaloneWebApplicationRoot(paths, standaloneRoot) {
  const repositoryRoot = realpathSync(path.resolve(paths.repositoryRoot));
  const webRoot = realpathSync(path.resolve(paths.webRoot));
  if (!isInside(repositoryRoot, webRoot)) {
    throw new Error("The Web application root escapes the selected repository.");
  }
  const relativeWebRoot = path.relative(repositoryRoot, webRoot);
  if (!relativeWebRoot || path.isAbsolute(relativeWebRoot) || relativeWebRoot.startsWith("..")) {
    throw new Error("The Web application root has no safe standalone-relative path.");
  }
  return confinedRealpath(
    standaloneRoot,
    path.join(standaloneRoot, relativeWebRoot),
    "Standalone Web application",
  );
}

function tracedPackageRoot({ repositoryRoot, sourceManifest, standaloneRoot, label }) {
  const canonicalRepositoryRoot = realpathSync(path.resolve(repositoryRoot));
  const sourcePackageRoot = realpathSync(path.dirname(sourceManifest));
  if (!isInside(canonicalRepositoryRoot, sourcePackageRoot)) {
    throw new Error(`${label} source escapes the selected repository: ${sourcePackageRoot}`);
  }
  return confinedRealpath(
    standaloneRoot,
    path.join(standaloneRoot, path.relative(canonicalRepositoryRoot, sourcePackageRoot)),
    label,
  );
}

function prepareStandalonePackageAlias({ standaloneRoot, destination, packageRoot, label }) {
  validateDestinationParent(standaloneRoot, destination, label);
  const existing = existingEntry(destination);
  if (existing) {
    let existingRoot;
    try {
      existingRoot = realpathSync(destination);
    } catch (error) {
      if (existing.isSymbolicLink() && error?.code === "ENOENT") {
        return Object.freeze({ destination, packageRoot, replace: true });
      }
      throw error;
    }
    if (!isInside(standaloneRoot, existingRoot)) {
      if (existing.isSymbolicLink()) {
        return Object.freeze({ destination, packageRoot, replace: true });
      }
      throw new Error(`${label} escapes the selected standalone root: ${destination}`);
    }
    if (existingRoot !== packageRoot) {
      if (!existingEntry(path.join(existingRoot, "package.json"))) {
        return Object.freeze({ destination, packageRoot, replace: true });
      }
      throw new Error(`${label} does not resolve to the traced package owner.`);
    }
  }
  return Object.freeze({ destination, packageRoot, replace: false, create: !existing });
}

function completeStandalonePackageAlias(plan, standaloneRoot, label) {
  if (plan.replace) {
    const existing = existingEntry(plan.destination);
    rmSync(plan.destination, {
      force: true,
      recursive: Boolean(existing?.isDirectory() && !existing.isSymbolicLink()),
    });
  }
  if (plan.create || plan.replace) {
    symlinkSync(
      path.relative(path.dirname(plan.destination), plan.packageRoot),
      plan.destination,
      "dir",
    );
  }
  const completedRoot = confinedRealpath(standaloneRoot, plan.destination, label);
  if (completedRoot !== plan.packageRoot) {
    throw new Error(`${label} changed owner while it was completed.`);
  }
  return completedRoot;
}

function replacePackageDirectory({ source, destination, standaloneRoot, label }) {
  const parent = validateReplacementDestination(standaloneRoot, destination, label);
  const sourceRoot = realpathSync(source);
  if (sourceRoot === destination) {
    throw new Error(`${label} source and destination must be different directories.`);
  }
  const temporaryRoot = mkdtempSync(path.join(parent, ".workbench-next-runtime-"));
  const stagedPackage = path.join(temporaryRoot, "package");
  try {
    cpSync(sourceRoot, stagedPackage, {
      dereference: true,
      force: true,
      preserveTimestamps: true,
      recursive: true,
    });
    rmSync(destination, { force: true, recursive: true });
    renameSync(stagedPackage, destination);
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
  return confinedRealpath(standaloneRoot, destination, label);
}

function assertPackageIdentity(actual, expected, label) {
  if (actual.name !== expected.name || actual.version !== expected.version) {
    throw new Error(
      `${label} does not match the installed build dependency: ${actual.name}@${actual.version} != ${expected.name}@${expected.version}.`,
    );
  }
}

function assertRequiredFiles(packageRoot, requiredFiles, label) {
  for (const relativeFile of requiredFiles) {
    const resolved = realpathSync(path.join(packageRoot, ...relativeFile.split("/")));
    if (!isInside(packageRoot, resolved)) {
      throw new Error(`${label} required file escapes its completed package: ${relativeFile}`);
    }
  }
}

function copyConfinedPackageFile({
  sourcePackageRoot,
  destinationPackageRoot,
  relativeFile,
  label,
}) {
  const segments = relativeFile.split("/");
  if (
    segments.length === 0 ||
    segments.some((segment) => !segment || segment === "." || segment === "..") ||
    relativeFile.includes("\\") ||
    path.isAbsolute(relativeFile)
  ) {
    throw new Error(`${label} has an invalid package-relative path: ${relativeFile}`);
  }
  const source = realpathSync(path.join(sourcePackageRoot, ...segments));
  const sourceStats = lstatSync(source);
  if (
    !isInside(sourcePackageRoot, source) ||
    !sourceStats.isFile() ||
    sourceStats.isSymbolicLink()
  ) {
    throw new Error(`${label} source is not a confined regular file: ${relativeFile}`);
  }

  const destination = path.join(destinationPackageRoot, ...segments);
  const destinationParent = path.dirname(destination);
  mkdirSync(destinationParent, { recursive: true });
  const canonicalParent = realpathSync(destinationParent);
  if (canonicalParent !== destinationParent || !isInside(destinationPackageRoot, canonicalParent)) {
    throw new Error(`${label} destination parent escapes its package: ${relativeFile}`);
  }
  const existing = existingEntry(destination);
  if (
    existing &&
    (!existing.isFile() || existing.isSymbolicLink() || realpathSync(destination) !== destination)
  ) {
    throw new Error(`${label} destination is not a canonical regular file: ${relativeFile}`);
  }
  cpSync(source, destination, { force: true, preserveTimestamps: true });
  const completed = realpathSync(destination);
  const completedStats = lstatSync(completed);
  if (
    completed !== destination ||
    !isInside(destinationPackageRoot, completed) ||
    !completedStats.isFile() ||
    completedStats.isSymbolicLink()
  ) {
    throw new Error(`${label} did not produce a confined regular file: ${relativeFile}`);
  }
  return completed;
}

function completeNextWebpackRuntime({
  repositoryRoot,
  sourceNextAlias,
  sourceNextRoot,
  sourceNext,
  standaloneRoot,
  runtimeNextRoot,
}) {
  const sourceRuntime = resolveWebArtifactNextWebpackRuntime({
    artifactRoot: repositoryRoot,
    nextAlias: sourceNextAlias,
  });
  assertPackageIdentity(
    sourceRuntime.packageIdentity,
    sourceNext,
    "Installed Next webpack runtime",
  );
  const configUtilsRelativePath = path
    .relative(sourceNextRoot, sourceRuntime.configUtils)
    .split(path.sep)
    .join("/");
  const files = [
    Object.freeze({
      relativeFile: configUtilsRelativePath,
      sourceFile: sourceRuntime.configUtils,
    }),
    ...sourceRuntime.resources.map((resource) =>
      Object.freeze({
        relativeFile: resource.nextPackageRelativePath,
        sourceFile: resource.runtimeFile,
      }),
    ),
  ];
  const completedFiles = files.map(({ relativeFile, sourceFile }) => {
    const canonicalSource = realpathSync(path.join(sourceNextRoot, ...relativeFile.split("/")));
    if (canonicalSource !== sourceFile) {
      throw new Error(`Installed Next webpack runtime source changed: ${relativeFile}`);
    }
    copyConfinedPackageFile({
      sourcePackageRoot: sourceNextRoot,
      destinationPackageRoot: runtimeNextRoot,
      relativeFile,
      label: "Standalone Next webpack runtime",
    });
    return relativeFile;
  });

  const completedRuntime = resolveWebArtifactNextWebpackRuntime({ artifactRoot: standaloneRoot });
  assertPackageIdentity(
    completedRuntime.packageIdentity,
    sourceNext,
    "Standalone Next webpack runtime",
  );
  const expectedClosure = sourceRuntime.resources
    .map((resource) => resource.nextPackageRelativePath)
    .sort();
  const completedClosure = completedRuntime.resources
    .map((resource) => resource.nextPackageRelativePath)
    .sort();
  if (JSON.stringify(completedClosure) !== JSON.stringify(expectedClosure)) {
    throw new Error(
      "Standalone Next webpack runtime dependency closure changed during completion.",
    );
  }
  return Object.freeze([...new Set(completedFiles)].sort());
}

/**
 * Completes the package branches and audited dynamic runtime files that Next 16's standalone
 * trace omits on Node 24.
 *
 * Node 24 selects `@swc/helpers`' `module-sync` export, while Next's generated trace currently
 * retains only the CommonJS helper files. Resolve the exact helper dependency selected by the
 * installed Next package, replace the partial traced package inside the chosen standalone root,
 * and add its exact tslib dependency. Every write target is validated against the standalone
 * root before the first replacement.
 */
function completeNextStandaloneRuntime({
  paths = createWorkbenchPaths(),
  standaloneRoot = paths.webStandaloneRoot,
} = {}) {
  const repositoryRoot = realpathSync(path.resolve(paths.repositoryRoot));
  const canonicalStandaloneRoot = realpathSync(path.resolve(standaloneRoot));
  const runtimeNodeModules = confinedRealpath(
    canonicalStandaloneRoot,
    path.join(canonicalStandaloneRoot, "node_modules"),
    "Standalone node_modules",
  );

  const webAppRequire = createRequire(path.join(paths.webRoot, "package.json"));
  const sourceNextManifest = webAppRequire.resolve("next/package.json");
  const sourceNext = packageIdentity(sourceNextManifest, "Installed Next");
  const sourceNextRequire = createRequire(sourceNextManifest);
  const sourceHelpersManifest = sourceNextRequire.resolve("@swc/helpers/package.json");
  const sourceHelpers = packageIdentity(sourceHelpersManifest, "Installed @swc/helpers");
  const sourceHelpersRoot = path.dirname(sourceHelpersManifest);
  const sourceHelpersRequire = createRequire(sourceHelpersManifest);
  const sourceTslibManifest = sourceHelpersRequire.resolve("tslib/package.json");
  const sourceTslib = packageIdentity(sourceTslibManifest, "Installed tslib");
  const sourceTslibRoot = path.dirname(sourceTslibManifest);

  const standaloneWebRoot = standaloneWebApplicationRoot(paths, canonicalStandaloneRoot);
  const runtimeNextRoot = tracedPackageRoot({
    repositoryRoot: paths.repositoryRoot,
    sourceManifest: sourceNextManifest,
    standaloneRoot: canonicalStandaloneRoot,
    label: "Standalone traced Next package",
  });
  const nextAliasPlans = [
    [path.join(standaloneWebRoot, "node_modules", "next"), "Standalone Web application Next alias"],
    [path.join(runtimeNodeModules, "next"), "Standalone root Next alias"],
  ].map(([destination, label]) => [
    prepareStandalonePackageAlias({
      standaloneRoot: canonicalStandaloneRoot,
      destination,
      packageRoot: runtimeNextRoot,
      label,
    }),
    label,
  ]);
  const runtimeNextManifest = confinedRealpath(
    canonicalStandaloneRoot,
    path.join(runtimeNextRoot, "package.json"),
    "Standalone Next manifest",
  );
  const runtimeNext = packageIdentity(runtimeNextManifest, "Standalone Next");
  assertPackageIdentity(runtimeNext, sourceNext, "Standalone Next");

  const runtimeHelpersRoot = tracedPackageRoot({
    repositoryRoot: paths.repositoryRoot,
    sourceManifest: sourceHelpersManifest,
    standaloneRoot: canonicalStandaloneRoot,
    label: "Standalone traced @swc/helpers package",
  });
  const runtimeHelpersManifest = confinedRealpath(
    canonicalStandaloneRoot,
    path.join(runtimeHelpersRoot, "package.json"),
    "Standalone @swc/helpers manifest",
  );
  const runtimeHelpers = packageIdentity(runtimeHelpersManifest, "Standalone @swc/helpers");
  assertPackageIdentity(runtimeHelpers, sourceHelpers, "Standalone @swc/helpers");
  const helpersAliasLabel = "Standalone Next @swc/helpers alias";
  const helpersAliasPlan = prepareStandalonePackageAlias({
    standaloneRoot: canonicalStandaloneRoot,
    destination: path.join(path.dirname(runtimeNextRoot), "@swc", "helpers"),
    packageRoot: runtimeHelpersRoot,
    label: helpersAliasLabel,
  });

  const runtimeTslibRoot = path.join(runtimeNodeModules, "tslib");
  validateReplacementDestination(
    canonicalStandaloneRoot,
    runtimeHelpersRoot,
    "Standalone @swc/helpers package",
  );
  validateReplacementDestination(
    canonicalStandaloneRoot,
    runtimeTslibRoot,
    "Standalone tslib package",
  );

  for (const [plan, label] of nextAliasPlans) {
    completeStandalonePackageAlias(plan, canonicalStandaloneRoot, label);
  }
  const completedNextRuntimeFiles = completeNextWebpackRuntime({
    repositoryRoot,
    sourceNextAlias: path.join(paths.webRoot, "node_modules", "next"),
    sourceNextRoot: path.dirname(sourceNextManifest),
    sourceNext,
    standaloneRoot: canonicalStandaloneRoot,
    runtimeNextRoot,
  });
  completeStandalonePackageAlias(helpersAliasPlan, canonicalStandaloneRoot, helpersAliasLabel);

  const completedHelpersRoot = replacePackageDirectory({
    source: sourceHelpersRoot,
    destination: runtimeHelpersRoot,
    standaloneRoot: canonicalStandaloneRoot,
    label: "Standalone @swc/helpers package",
  });
  const completedTslibRoot = replacePackageDirectory({
    source: sourceTslibRoot,
    destination: runtimeTslibRoot,
    standaloneRoot: canonicalStandaloneRoot,
    label: "Standalone tslib package",
  });
  assertRequiredFiles(
    completedHelpersRoot,
    REQUIRED_HELPER_FILES,
    "Standalone @swc/helpers package",
  );
  assertRequiredFiles(completedTslibRoot, REQUIRED_TSLIB_FILES, "Standalone tslib package");

  return Object.freeze({
    standaloneRoot: canonicalStandaloneRoot,
    nextVersion: sourceNext.version,
    completedNextRuntimeFiles,
    completedPackages: Object.freeze([
      Object.freeze({
        name: sourceHelpers.name,
        version: sourceHelpers.version,
        destination: completedHelpersRoot,
      }),
      Object.freeze({
        name: sourceTslib.name,
        version: sourceTslib.version,
        destination: completedTslibRoot,
      }),
    ]),
  });
}

if (require.main === module) {
  try {
    const report = completeNextStandaloneRuntime();
    console.log(
      `[web-standalone] Completed ${report.completedPackages.map(({ name, version }) => `${name}@${version}`).join(", ")} for Next ${report.nextVersion}.`,
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

module.exports = {
  REQUIRED_HELPER_FILES,
  REQUIRED_TSLIB_FILES,
  completeNextStandaloneRuntime,
};
