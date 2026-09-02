const path = require("node:path");

const DEFAULT_REPOSITORY_ROOT = path.resolve(__dirname, "..");

/**
 * Resolve the application and artifact roots used by repository-level orchestration.
 *
 * Each app owns an exact workspace root. Repository-level commands remain thin orchestration
 * delegates while shared Desktop build and Electron staging outputs stay at stable roots.
 */
function createWorkbenchPaths({ repositoryRoot = DEFAULT_REPOSITORY_ROOT } = {}) {
  const resolvedRepositoryRoot = path.resolve(repositoryRoot);
  const webRoot = path.join(resolvedRepositoryRoot, "apps", "web");
  const webSourceRoot = path.join(webRoot, "src");
  const webPublicRoot = path.join(webRoot, "public");
  const webRelativeAppDirectory = path.join("apps", "web");
  const desktopRendererRoot = path.join(resolvedRepositoryRoot, "apps", "desktop-renderer");
  const desktopRendererSourceRoot = path.join(desktopRendererRoot, "src");
  const desktopRendererPublicRoot = path.join(desktopRendererRoot, "public");
  const runtimeAppRoot = path.join(resolvedRepositoryRoot, "apps", "runtime-node");
  const desktopElectronRoot = path.join(resolvedRepositoryRoot, "apps", "desktop-electron");
  const desktopElectronSourceRoot = path.join(desktopElectronRoot, "src");
  const desktopElectronScriptsRoot = path.join(desktopElectronRoot, "scripts");
  const stagingRoot = path.join(resolvedRepositoryRoot, ".electron-build");
  const webBuildRoot = path.join(webRoot, ".next");
  const desktopRendererBuildRoot = path.join(desktopRendererRoot, ".next");
  const desktopRendererExportRoot = path.join(desktopRendererRoot, "out");
  const desktopArtifactBuildRoot = path.join(resolvedRepositoryRoot, ".desktop-build");
  const desktopRendererArtifactRoot = path.join(desktopArtifactBuildRoot, "desktop-renderer");
  const runtimeArtifactRoot = path.join(desktopArtifactBuildRoot, "runtime-node");
  const electronAppStagingRoot = path.join(stagingRoot, "app");
  const desktopRuntimeStagingRoot = path.join(electronAppStagingRoot, "desktop-runtime");
  const desktopArtifactCompositionSourcePath = path.join(
    desktopArtifactBuildRoot,
    "desktop-artifacts.json",
  );

  return Object.freeze({
    repositoryRoot: resolvedRepositoryRoot,
    webRoot,
    webSourceRoot,
    webPublicRoot,
    webRelativeAppDirectory,
    desktopRendererRoot,
    desktopRendererSourceRoot,
    desktopRendererPublicRoot,
    runtimeAppRoot,
    desktopElectronRoot,
    desktopElectronSourceRoot,
    desktopElectronScriptsRoot,
    stagingRoot,
    webBuildRoot,
    desktopRendererBuildRoot,
    desktopRendererExportRoot,
    webStandaloneRoot: path.join(webBuildRoot, "standalone"),
    webStandaloneAppRoot: path.join(webBuildRoot, "standalone", webRelativeAppDirectory),
    desktopArtifactBuildRoot,
    desktopArtifactCompositionSourcePath,
    desktopRendererArtifactRoot,
    desktopRendererArtifactManifestPath: path.join(
      desktopRendererArtifactRoot,
      "artifact-manifest.json",
    ),
    runtimeArtifactRoot,
    electronAppStagingRoot,
    desktopRuntimeStagingRoot,
    desktopArtifactCompositionPath: path.join(desktopRuntimeStagingRoot, "desktop-artifacts.json"),
    desktopRendererArtifactStagingRoot: path.join(desktopRuntimeStagingRoot, "desktop-renderer"),
    desktopRuntimeArtifactStagingRoot: path.join(desktopRuntimeStagingRoot, "runtime-node"),
    electronOutputRoot: path.join(resolvedRepositoryRoot, "dist-electron"),
  });
}

const defaultWorkbenchPaths = createWorkbenchPaths();

module.exports = {
  DEFAULT_REPOSITORY_ROOT,
  createWorkbenchPaths,
  defaultWorkbenchPaths,
  ...defaultWorkbenchPaths,
};
