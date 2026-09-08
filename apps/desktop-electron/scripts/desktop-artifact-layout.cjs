const { lstatSync, readFileSync, realpathSync } = require("node:fs");
const path = require("node:path");

const { resolveDesktopArtifactSupport } = require("../src/runtime-artifact-environment.cjs");

const DESKTOP_ARTIFACT_COMPOSITION_FILENAME = "desktop-artifacts.json";
const DESKTOP_ARTIFACT_COMPOSITION_SCHEMA_VERSION = 1;
const DESKTOP_ARTIFACT_COMPOSITION_KIND = "workbench-desktop-artifacts";
const DESKTOP_ARTIFACT_COMPOSITION_MAX_BYTES = 64 * 1024;

function isPathInside(rootDirectory, candidatePath) {
  const relative = path.relative(path.resolve(rootDirectory), path.resolve(candidatePath));
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function isPortableRelativePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4_096 &&
    !value.includes("\\") &&
    !path.posix.isAbsolute(value) &&
    !/^[A-Za-z]:/u.test(value) &&
    value.split("/").every((segment) => segment && segment !== "." && segment !== "..")
  );
}

function assertDesktopArtifactComposition(value) {
  const keys = [
    "artifactKind",
    "rendererArtifactManifest",
    "runtimeArtifactManifest",
    "schemaVersion",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys) ||
    value.schemaVersion !== DESKTOP_ARTIFACT_COMPOSITION_SCHEMA_VERSION ||
    value.artifactKind !== DESKTOP_ARTIFACT_COMPOSITION_KIND ||
    value.rendererArtifactManifest !== "desktop-renderer/artifact-manifest.json" ||
    !isPortableRelativePath(value.runtimeArtifactManifest) ||
    !/^runtime-node\/[^/]+\/artifact-manifest\.json$/u.test(value.runtimeArtifactManifest)
  ) {
    throw new Error("The desktop artifact composition manifest is invalid.");
  }
  return Object.freeze({
    schemaVersion: DESKTOP_ARTIFACT_COMPOSITION_SCHEMA_VERSION,
    artifactKind: DESKTOP_ARTIFACT_COMPOSITION_KIND,
    rendererArtifactManifest: value.rendererArtifactManifest,
    runtimeArtifactManifest: value.runtimeArtifactManifest,
  });
}

function readDesktopArtifactComposition(runtimeRoot, { readFile = readFileSync } = {}) {
  const resolvedRoot = path.resolve(runtimeRoot);
  const manifestPath = path.join(resolvedRoot, DESKTOP_ARTIFACT_COMPOSITION_FILENAME);
  const stats = lstatSync(manifestPath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("The desktop artifact composition manifest must be a regular file.");
  }
  if (stats.size > DESKTOP_ARTIFACT_COMPOSITION_MAX_BYTES) {
    throw new Error("The desktop artifact composition manifest exceeds its size limit.");
  }
  const canonicalRoot = realpathSync(resolvedRoot);
  const canonicalManifest = realpathSync(manifestPath);
  if (canonicalRoot !== resolvedRoot || !isPathInside(canonicalRoot, canonicalManifest)) {
    throw new Error("The desktop artifact composition root is not canonical and confined.");
  }
  return Object.freeze({
    manifest: assertDesktopArtifactComposition(JSON.parse(readFile(canonicalManifest, "utf8"))),
    manifestPath: canonicalManifest,
    runtimeRoot: canonicalRoot,
  });
}

function resolveManifestReference(runtimeRoot, relativePath, ownerDirectory, label) {
  const owner = path.join(runtimeRoot, ownerDirectory);
  const manifest = path.resolve(runtimeRoot, ...relativePath.split("/"));
  if (!isPathInside(owner, manifest)) {
    throw new Error(`${label} manifest escapes its staged owner root.`);
  }
  const stats = lstatSync(manifest);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} manifest must be a regular file.`);
  }
  const canonicalOwner = realpathSync(owner);
  const canonicalManifest = realpathSync(manifest);
  if (canonicalOwner !== owner || !isPathInside(canonicalOwner, canonicalManifest)) {
    throw new Error(`${label} manifest escapes its canonical staged owner root.`);
  }
  return canonicalManifest;
}

async function resolveDesktopArtifactLayout(
  runtimeDirectory,
  {
    expectedRendererBuildId,
    expectedTarget,
    deriveRuntimeTargetKey,
    readComposition = readDesktopArtifactComposition,
    resolveRenderer,
    resolveRuntime,
  } = {},
) {
  const composition = readComposition(runtimeDirectory);
  const { supportPath } = resolveDesktopArtifactSupport(composition.runtimeRoot);
  const rendererManifestPath = resolveManifestReference(
    composition.runtimeRoot,
    composition.manifest.rendererArtifactManifest,
    "desktop-renderer",
    "Desktop renderer artifact",
  );
  const runtimeManifestPath = resolveManifestReference(
    composition.runtimeRoot,
    composition.manifest.runtimeArtifactManifest,
    "runtime-node",
    "Runtime artifact",
  );
  const resolveRendererArtifact =
    resolveRenderer ?? require("./desktop-renderer-artifact.cjs").resolveDesktopRendererArtifact;
  const resolveRuntimeArtifact =
    resolveRuntime ?? require("./runtime-artifact-admission.cjs").resolveDesktopRuntimeArtifact;
  const [renderer, runtime] = await Promise.all([
    resolveRendererArtifact({
      manifestPath: rendererManifestPath,
      expectedBuildId: expectedRendererBuildId,
    }),
    resolveRuntimeArtifact({ manifestPath: runtimeManifestPath, expectedTarget }),
  ]);
  if (
    realpathSync(renderer.manifestPath) !== rendererManifestPath ||
    realpathSync(runtime.manifestPath) !== runtimeManifestPath
  ) {
    throw new Error("The desktop composition resolved a different child artifact manifest.");
  }
  const runtimeTargetKey =
    deriveRuntimeTargetKey ??
    require("@workbench/host-contracts/runtime-artifact-manifest").runtimeArtifactTargetKey;
  const runtimeDirectoryName = composition.manifest.runtimeArtifactManifest.split("/")[1];
  // Packaged desktops use a compact directory; target identity is checked by
  // the Runtime admission resolver above, independently of the directory name.
  if (
    runtimeDirectoryName !== "current" &&
    runtimeDirectoryName !== runtimeTargetKey(runtime.manifest.target)
  ) {
    throw new Error("The desktop composition Runtime directory does not match its target key.");
  }
  return Object.freeze({ ...composition, renderer, runtime, supportPath });
}

function relativeManifestReference(runtimeRoot, manifestPath, ownerDirectory, label) {
  const root = path.resolve(runtimeRoot);
  const absolute = path.resolve(manifestPath);
  if (!isPathInside(path.join(root, ownerDirectory), absolute)) {
    throw new Error(`${label} manifest escapes its desktop composition owner root.`);
  }
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  if (!isPortableRelativePath(relative)) {
    throw new Error(`${label} manifest has an invalid desktop composition reference.`);
  }
  return relative;
}

function createDesktopArtifactComposition({
  runtimeRoot,
  rendererManifestPath,
  runtimeManifestPath,
}) {
  return assertDesktopArtifactComposition({
    schemaVersion: DESKTOP_ARTIFACT_COMPOSITION_SCHEMA_VERSION,
    artifactKind: DESKTOP_ARTIFACT_COMPOSITION_KIND,
    rendererArtifactManifest: relativeManifestReference(
      runtimeRoot,
      rendererManifestPath,
      "desktop-renderer",
      "Desktop renderer artifact",
    ),
    runtimeArtifactManifest: relativeManifestReference(
      runtimeRoot,
      runtimeManifestPath,
      "runtime-node",
      "Runtime artifact",
    ),
  });
}

module.exports = {
  DESKTOP_ARTIFACT_COMPOSITION_FILENAME,
  DESKTOP_ARTIFACT_COMPOSITION_KIND,
  DESKTOP_ARTIFACT_COMPOSITION_MAX_BYTES,
  DESKTOP_ARTIFACT_COMPOSITION_SCHEMA_VERSION,
  assertDesktopArtifactComposition,
  createDesktopArtifactComposition,
  isPathInside,
  isPortableRelativePath,
  readDesktopArtifactComposition,
  resolveDesktopArtifactLayout,
};
