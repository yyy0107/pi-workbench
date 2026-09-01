const { lstatSync, mkdirSync, realpathSync, rmSync } = require("node:fs");
const path = require("node:path");

const { createWorkbenchPaths } = require("./workbench-paths.cjs");

/**
 * Root build orchestration owns the one full envelope cleanup. Target builders only replace their
 * own output, so the Runtime, Web, and Desktop renderer artifacts cannot delete each other
 * afterward.
 */
function assertCanonicalDirectory(directory, label) {
  let stats;
  try {
    stats = lstatSync(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (stats.isSymbolicLink() || realpathSync(directory) !== directory) {
    throw new Error(`Refusing to clean through an aliased ${label}: ${directory}.`);
  }
}

function assertCleanupRoot(candidate, expected, label) {
  if (typeof candidate !== "string" || candidate !== expected || !path.isAbsolute(candidate)) {
    throw new Error(`Refusing to clean an unexpected ${label}: ${String(candidate)}.`);
  }
  assertCanonicalDirectory(path.dirname(candidate), `${label} parent`);
  assertCanonicalDirectory(candidate, label);
  return candidate;
}

function prepareWorkbenchBuild({ paths = createWorkbenchPaths() } = {}) {
  const repositoryRoot = paths.repositoryRoot;
  if (
    typeof repositoryRoot !== "string" ||
    !path.isAbsolute(repositoryRoot) ||
    path.resolve(repositoryRoot) !== repositoryRoot
  ) {
    throw new Error(
      `Refusing to clean from an unexpected repository root: ${String(repositoryRoot)}.`,
    );
  }
  assertCanonicalDirectory(repositoryRoot, "repository root");

  const webBuildRoot = assertCleanupRoot(
    paths.webBuildRoot,
    path.join(repositoryRoot, "apps", "web", ".next"),
    "Web build root",
  );
  const desktopRendererBuildRoot = assertCleanupRoot(
    paths.desktopRendererBuildRoot,
    path.join(repositoryRoot, "apps", "desktop-renderer", ".next"),
    "Desktop renderer build root",
  );
  const desktopRendererExportRoot = assertCleanupRoot(
    paths.desktopRendererExportRoot,
    path.join(repositoryRoot, "apps", "desktop-renderer", "out"),
    "Desktop renderer export root",
  );
  const buildRoot = assertCleanupRoot(
    paths.desktopArtifactBuildRoot,
    path.join(repositoryRoot, ".desktop-build"),
    "desktop artifact build root",
  );
  const stagingRoot = assertCleanupRoot(
    paths.stagingRoot,
    path.join(repositoryRoot, ".electron-build"),
    "Electron staging root",
  );
  const cleanupRoots = [
    webBuildRoot,
    desktopRendererBuildRoot,
    desktopRendererExportRoot,
    buildRoot,
    stagingRoot,
  ];
  if (new Set(cleanupRoots).size !== cleanupRoots.length) {
    throw new Error("Refusing to clean aliased Workbench output roots.");
  }

  for (const root of cleanupRoots) {
    rmSync(root, { force: true, recursive: true });
  }
  mkdirSync(buildRoot, { recursive: true });
  return buildRoot;
}

if (require.main === module) prepareWorkbenchBuild();

module.exports = { prepareWorkbenchBuild };
