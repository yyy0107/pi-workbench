const { cpSync, lstatSync, readFileSync, realpathSync } = require("node:fs");
const path = require("node:path");

const {
  DESKTOP_RENDERER_ARTIFACT_MANIFEST_FILENAME,
  assertDesktopRendererArtifactManifest,
} = require("@workbench/host-contracts/desktop-renderer-artifact-manifest");

const { assertArtifactTreeEquivalent, snapshotArtifactTree } = require("./artifact-tree.cjs");

const DESKTOP_RENDERER_ARTIFACT_MANIFEST_MAX_BYTES = 16 * 1024 * 1024;

function isPathInside(rootDirectory, candidatePath) {
  const relative = path.relative(path.resolve(rootDirectory), path.resolve(candidatePath));
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function canonicalRequestedPath(value, label) {
  if (
    typeof value !== "string" ||
    !path.isAbsolute(value) ||
    path.normalize(value) !== value ||
    path.resolve(value) !== value
  ) {
    throw new Error(`${label} must be an absolute canonical path without aliases.`);
  }
  return value;
}

function resolveDesktopRendererArtifact({ artifactRoot, manifestPath, expectedBuildId } = {}) {
  if (!artifactRoot && !manifestPath) {
    throw new Error("A Desktop renderer artifact root or manifest path is required.");
  }
  const requestedRoot = artifactRoot
    ? canonicalRequestedPath(artifactRoot, "The Desktop renderer artifact root")
    : path.dirname(
        canonicalRequestedPath(manifestPath, "The Desktop renderer artifact manifest path"),
      );
  const requestedManifest = canonicalRequestedPath(
    manifestPath ?? path.join(requestedRoot, DESKTOP_RENDERER_ARTIFACT_MANIFEST_FILENAME),
    "The Desktop renderer artifact manifest path",
  );
  if (
    path.basename(requestedManifest) !== DESKTOP_RENDERER_ARTIFACT_MANIFEST_FILENAME ||
    path.dirname(requestedManifest) !== requestedRoot
  ) {
    throw new Error("The Desktop renderer artifact root and manifest path disagree.");
  }

  const rootStats = lstatSync(requestedRoot);
  if (
    !rootStats.isDirectory() ||
    rootStats.isSymbolicLink() ||
    realpathSync(requestedRoot) !== requestedRoot
  ) {
    throw new Error("The Desktop renderer artifact root must be a canonical real directory.");
  }
  const manifestStats = lstatSync(requestedManifest);
  if (
    !manifestStats.isFile() ||
    manifestStats.isSymbolicLink() ||
    manifestStats.size <= 0 ||
    manifestStats.size > DESKTOP_RENDERER_ARTIFACT_MANIFEST_MAX_BYTES ||
    realpathSync(requestedManifest) !== requestedManifest ||
    !isPathInside(requestedRoot, requestedManifest)
  ) {
    throw new Error(
      "The Desktop renderer artifact manifest must be canonical, confined, and bounded.",
    );
  }

  let manifestValue;
  try {
    manifestValue = JSON.parse(readFileSync(requestedManifest, "utf8"));
  } catch {
    throw new Error("The Desktop renderer artifact manifest is invalid JSON.");
  }
  const manifest = assertDesktopRendererArtifactManifest(manifestValue);
  if (expectedBuildId !== undefined && manifest.buildId !== expectedBuildId) {
    throw new Error(
      `Desktop renderer artifact build identity changed: ${manifest.buildId}; expected ${expectedBuildId}.`,
    );
  }

  const measured = snapshotArtifactTree(requestedRoot, { label: "Desktop renderer artifact" });
  if (measured.some((entry) => entry.type !== "file")) {
    throw new Error("The Desktop renderer artifact must not contain filesystem links.");
  }
  const files = measured
    .filter((entry) => entry.path !== DESKTOP_RENDERER_ARTIFACT_MANIFEST_FILENAME)
    .map(({ path: filePath, size, sha256, mode }) => ({ path: filePath, size, sha256, mode }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  if (JSON.stringify(files) !== JSON.stringify(manifest.files)) {
    throw new Error("The Desktop renderer artifact inventory does not match its final bytes.");
  }

  const entrypoint = path.join(requestedRoot, ...manifest.entrypoint.split("/"));
  const entrypointStats = lstatSync(entrypoint);
  if (
    !entrypointStats.isFile() ||
    entrypointStats.isSymbolicLink() ||
    realpathSync(entrypoint) !== entrypoint
  ) {
    throw new Error("The Desktop renderer artifact entrypoint must be a canonical regular file.");
  }
  return Object.freeze({
    artifactRoot: requestedRoot,
    entrypoint,
    manifest,
    manifestPath: requestedManifest,
  });
}

function stageDesktopRendererArtifact({ sourceArtifact, destinationRoot, expectedBuildId } = {}) {
  const source = resolveDesktopRendererArtifact({
    artifactRoot: sourceArtifact?.artifactRoot,
    expectedBuildId: expectedBuildId ?? sourceArtifact?.manifest?.buildId,
  });
  const destination = path.resolve(destinationRoot);
  const parent = path.dirname(destination);
  if (realpathSync(parent) !== parent) {
    throw new Error("The Desktop renderer artifact staging parent must be canonical.");
  }
  try {
    lstatSync(destination);
    throw new Error("The staged Desktop renderer artifact root must not exist before staging.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (
    isPathInside(source.artifactRoot, destination) ||
    isPathInside(destination, source.artifactRoot)
  ) {
    throw new Error("The source and staged Desktop renderer artifact roots must not overlap.");
  }
  cpSync(source.artifactRoot, destination, {
    dereference: false,
    preserveTimestamps: true,
    recursive: true,
    verbatimSymlinks: true,
  });
  const staged = resolveDesktopRendererArtifact({
    artifactRoot: destination,
    expectedBuildId: source.manifest.buildId,
  });
  assertArtifactTreeEquivalent(source.artifactRoot, staged.artifactRoot, {
    expectedLabel: "source Desktop renderer artifact",
    actualLabel: "staged Desktop renderer artifact",
  });
  return staged;
}

module.exports = {
  DESKTOP_RENDERER_ARTIFACT_MANIFEST_MAX_BYTES,
  resolveDesktopRendererArtifact,
  stageDesktopRendererArtifact,
};
