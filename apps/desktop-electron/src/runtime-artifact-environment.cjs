const { lstatSync, realpathSync } = require("node:fs");
const path = require("node:path");

const RUNTIME_ARTIFACT_OVERRIDE_ENVIRONMENT_VARIABLES = Object.freeze([
  "WORKBENCH_RUNTIME_ARTIFACT_MANIFEST",
  "WORKBENCH_RUNTIME_ARTIFACT_TARGET_JSON",
]);
const DESKTOP_ARTIFACT_SUPPORT_FILENAME = "desktop-artifact-support.cjs";

function isPathInside(rootDirectory, candidatePath) {
  const relative = path.relative(path.resolve(rootDirectory), path.resolve(candidatePath));
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function resolveDesktopArtifactSupport(runtimeDirectory) {
  if (typeof runtimeDirectory !== "string" || runtimeDirectory.length === 0) {
    throw new Error("A desktop runtime directory is required.");
  }
  const requestedRoot = path.resolve(runtimeDirectory);
  const rootStats = lstatSync(requestedRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("The desktop runtime root must be a regular directory.");
  }
  const runtimeRoot = realpathSync(requestedRoot);
  if (runtimeRoot !== requestedRoot) {
    throw new Error("The desktop runtime root must be canonical.");
  }

  const requestedSupport = path.join(runtimeRoot, DESKTOP_ARTIFACT_SUPPORT_FILENAME);
  const supportStats = lstatSync(requestedSupport);
  if (!supportStats.isFile() || supportStats.isSymbolicLink()) {
    throw new Error("The desktop artifact support module must be a regular file.");
  }
  const supportPath = realpathSync(requestedSupport);
  if (supportPath !== requestedSupport || !isPathInside(runtimeRoot, supportPath)) {
    throw new Error("The desktop artifact support module must be canonical and confined.");
  }
  return Object.freeze({ runtimeRoot, supportPath });
}

/** Packaged Electron always selects the sole adjacent, validated Runtime target. */
function removeRuntimeArtifactOverrides(environment) {
  for (const name of RUNTIME_ARTIFACT_OVERRIDE_ENVIRONMENT_VARIABLES) delete environment[name];
  return environment;
}

module.exports = {
  DESKTOP_ARTIFACT_SUPPORT_FILENAME,
  RUNTIME_ARTIFACT_OVERRIDE_ENVIRONMENT_VARIABLES,
  removeRuntimeArtifactOverrides,
  resolveDesktopArtifactSupport,
};
