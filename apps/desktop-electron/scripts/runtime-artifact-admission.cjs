const { existsSync, lstatSync, readdirSync, realpathSync } = require("node:fs");
const path = require("node:path");

const {
  RUNTIME_ARTIFACT_MANIFEST_FILENAME,
  runtimeArtifactTargetKey,
} = require("@workbench/host-contracts/runtime-artifact-manifest");
const { resolveRuntimeArtifact } = require("@workbench/host-server/runtime-artifact");
const {
  createRuntimeArtifactAdmissionPolicy,
} = require("@workbench/host-artifact-policy/runtime-admission");
const { STREAM_PATHS } = require("@workbench/agent-runtime-pi-protocol/stream");

const DESKTOP_RUNTIME_ARTIFACT_ADMISSION_POLICY = createRuntimeArtifactAdmissionPolicy([
  STREAM_PATHS.mux,
  STREAM_PATHS.host,
]);
const DESKTOP_RUNTIME_UPGRADE_PATHS =
  DESKTOP_RUNTIME_ARTIFACT_ADMISSION_POLICY.expectedUpgradePaths;

function canonicalRegularManifest(candidate, label) {
  if (
    typeof candidate !== "string" ||
    !path.isAbsolute(candidate) ||
    path.normalize(candidate) !== candidate ||
    path.resolve(candidate) !== candidate
  ) {
    throw new Error(`${label} must be an absolute canonical path without aliases.`);
  }
  const absolute = path.resolve(candidate);
  const stats = lstatSync(absolute);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file.`);
  }
  const canonical = realpathSync(absolute);
  if (canonical !== absolute) {
    throw new Error(`${label} must be canonical.`);
  }
  return canonical;
}

function selectRuntimeArtifactManifest(artifactRoot, expectedTarget) {
  if (typeof artifactRoot !== "string" || artifactRoot.length === 0) {
    throw new Error("A Runtime artifact selection root is required.");
  }
  const requestedRoot = path.resolve(artifactRoot);
  const rootStats = lstatSync(requestedRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("The Runtime artifact selection root must be a regular directory.");
  }
  const root = realpathSync(requestedRoot);
  if (root !== requestedRoot) {
    throw new Error("The Runtime artifact selection root must be canonical.");
  }
  const directManifest = path.join(root, RUNTIME_ARTIFACT_MANIFEST_FILENAME);
  if (existsSync(directManifest)) {
    return canonicalRegularManifest(directManifest, "Runtime artifact manifest");
  }
  if (expectedTarget) {
    const targetManifest = path.join(
      root,
      runtimeArtifactTargetKey(expectedTarget),
      RUNTIME_ARTIFACT_MANIFEST_FILENAME,
    );
    return canonicalRegularManifest(targetManifest, "Runtime artifact target manifest");
  }
  const manifestPaths = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => path.join(root, entry.name, RUNTIME_ARTIFACT_MANIFEST_FILENAME))
    .filter(existsSync)
    .sort();
  if (manifestPaths.length !== 1) {
    throw new Error(
      manifestPaths.length === 0
        ? "No Runtime artifact manifest exists below the selection root."
        : "Multiple Runtime artifact manifests exist below the selection root.",
    );
  }
  return canonicalRegularManifest(manifestPaths[0], "Runtime artifact manifest");
}

async function resolveDesktopRuntimeArtifact({
  artifactRoot,
  manifestPath,
  expectedTarget,
  processIdentity,
  resolveArtifact = resolveRuntimeArtifact,
} = {}) {
  if (manifestPath && artifactRoot) {
    const expectedRoot = path.dirname(path.resolve(manifestPath));
    if (path.resolve(artifactRoot) !== expectedRoot) {
      throw new Error("The Runtime artifact root and manifest path disagree.");
    }
  }
  const selectedManifest = manifestPath
    ? canonicalRegularManifest(manifestPath, "Runtime artifact manifest")
    : selectRuntimeArtifactManifest(artifactRoot, expectedTarget);
  const artifact = await resolveArtifact({
    manifestPath: selectedManifest,
    policy: DESKTOP_RUNTIME_ARTIFACT_ADMISSION_POLICY,
    ...(expectedTarget ? { expectedTarget } : { processIdentity }),
  });
  const expectedDirectory = runtimeArtifactTargetKey(artifact.manifest.target);
  if (path.basename(artifact.artifactRoot) !== expectedDirectory) {
    throw new Error("The Runtime artifact directory does not match its canonical target key.");
  }
  if (realpathSync(artifact.manifestPath) !== selectedManifest) {
    throw new Error("The Runtime artifact resolver selected a different manifest.");
  }
  return artifact;
}

async function resolveStagedDesktopRuntimeArtifact({
  runtimeDirectory,
  runtimeArtifact,
  expectedTarget,
  resolveArtifact = resolveDesktopRuntimeArtifact,
} = {}) {
  if (
    typeof runtimeDirectory !== "string" ||
    !path.isAbsolute(runtimeDirectory) ||
    path.normalize(runtimeDirectory) !== runtimeDirectory ||
    path.resolve(runtimeDirectory) !== runtimeDirectory
  ) {
    throw new Error("The staged Runtime selection root must be an absolute canonical path.");
  }
  const selected = await resolveArtifact({
    artifactRoot: runtimeDirectory,
    expectedTarget,
  });
  if (
    runtimeArtifact &&
    (runtimeArtifact.artifactRoot !== selected.artifactRoot ||
      runtimeArtifact.manifestPath !== selected.manifestPath)
  ) {
    throw new Error("The staged Runtime descriptor is outside the admitted selection root.");
  }
  return selected;
}

module.exports = {
  DESKTOP_RUNTIME_ARTIFACT_ADMISSION_POLICY,
  DESKTOP_RUNTIME_UPGRADE_PATHS,
  resolveDesktopRuntimeArtifact,
  resolveStagedDesktopRuntimeArtifact,
  selectRuntimeArtifactManifest,
};
