const assert = require("node:assert/strict");
const { existsSync, mkdtempSync, readFileSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createWorkbenchPaths, defaultWorkbenchPaths } = require("./workbench-paths.cjs");

const REPOSITORY_ROOT = path.resolve(__dirname, "..");

test("maps every application and artifact root from an injectable repository root", (t) => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "workbench-path-model-"));
  const repositoryRoot = path.join(parent, "arbitrary-repository");
  t.after(() => rmSync(parent, { force: true, recursive: true }));

  const paths = createWorkbenchPaths({ repositoryRoot });

  assert.deepEqual(paths, {
    repositoryRoot,
    webRoot: path.join(repositoryRoot, "apps", "web"),
    webSourceRoot: path.join(repositoryRoot, "apps", "web", "src"),
    webPublicRoot: path.join(repositoryRoot, "apps", "web", "public"),
    webRelativeAppDirectory: path.join("apps", "web"),
    desktopRendererRoot: path.join(repositoryRoot, "apps", "desktop-renderer"),
    desktopRendererSourceRoot: path.join(repositoryRoot, "apps", "desktop-renderer", "src"),
    desktopRendererPublicRoot: path.join(repositoryRoot, "apps", "desktop-renderer", "public"),
    runtimeAppRoot: path.join(repositoryRoot, "apps", "runtime-node"),
    desktopElectronRoot: path.join(repositoryRoot, "apps", "desktop-electron"),
    desktopElectronSourceRoot: path.join(repositoryRoot, "apps", "desktop-electron", "src"),
    desktopElectronScriptsRoot: path.join(repositoryRoot, "apps", "desktop-electron", "scripts"),
    tauriRoot: path.join(repositoryRoot, "apps", "desktop-tauri"),
    stagingRoot: path.join(repositoryRoot, ".electron-build"),
    webBuildRoot: path.join(repositoryRoot, "apps", "web", ".next"),
    desktopRendererBuildRoot: path.join(repositoryRoot, "apps", "desktop-renderer", ".next"),
    desktopRendererExportRoot: path.join(repositoryRoot, "apps", "desktop-renderer", "out"),
    webStandaloneRoot: path.join(repositoryRoot, "apps", "web", ".next", "standalone"),
    webStandaloneAppRoot: path.join(
      repositoryRoot,
      "apps",
      "web",
      ".next",
      "standalone",
      "apps",
      "web",
    ),
    desktopArtifactBuildRoot: path.join(repositoryRoot, ".desktop-build"),
    desktopArtifactCompositionSourcePath: path.join(
      repositoryRoot,
      ".desktop-build",
      "desktop-artifacts.json",
    ),
    desktopRendererArtifactRoot: path.join(repositoryRoot, ".desktop-build", "desktop-renderer"),
    desktopRendererArtifactManifestPath: path.join(
      repositoryRoot,
      ".desktop-build",
      "desktop-renderer",
      "artifact-manifest.json",
    ),
    runtimeArtifactRoot: path.join(repositoryRoot, ".desktop-build", "runtime-node"),
    electronAppStagingRoot: path.join(repositoryRoot, ".electron-build", "app"),
    desktopRuntimeStagingRoot: path.join(
      repositoryRoot,
      ".electron-build",
      "app",
      "desktop-runtime",
    ),
    desktopArtifactCompositionPath: path.join(
      repositoryRoot,
      ".electron-build",
      "app",
      "desktop-runtime",
      "desktop-artifacts.json",
    ),
    desktopRendererArtifactStagingRoot: path.join(
      repositoryRoot,
      ".electron-build",
      "app",
      "desktop-runtime",
      "desktop-renderer",
    ),
    desktopRuntimeArtifactStagingRoot: path.join(
      repositoryRoot,
      ".electron-build",
      "app",
      "desktop-runtime",
      "runtime-node",
    ),
    electronOutputRoot: path.join(repositoryRoot, "dist-electron"),
  });
  assert.equal(Object.isFrozen(paths), true);
  assert.equal(existsSync(repositoryRoot), false);
  assert.equal(existsSync(defaultWorkbenchPaths.tauriRoot), true);
});

test("exports the current repository mapping without requiring each caller to derive it", () => {
  assert.equal(defaultWorkbenchPaths.repositoryRoot, REPOSITORY_ROOT);
  assert.equal(
    defaultWorkbenchPaths.webBuildRoot,
    path.join(REPOSITORY_ROOT, "apps", "web", ".next"),
  );
  assert.equal(
    defaultWorkbenchPaths.desktopRuntimeStagingRoot,
    path.join(REPOSITORY_ROOT, ".electron-build", "app", "desktop-runtime"),
  );
  assert.equal(
    defaultWorkbenchPaths.desktopRendererArtifactManifestPath,
    path.join(REPOSITORY_ROOT, ".desktop-build", "desktop-renderer", "artifact-manifest.json"),
  );
});

test("root build delegates to apps while permanent start uses repository orchestration", () => {
  const rootPackage = JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, "package.json"), "utf8"));
  assert.match(rootPackage.scripts.build, /pnpm --filter @workbench\/web build/u);
  assert.doesNotMatch(rootPackage.scripts.build, /(?:^|&&\s*)next build(?:\s|$)/u);
  assert.equal(rootPackage.scripts.start, "node scripts/web-runtime-orchestrator.mjs --production");
});

test("path-model callers use the shared model without the removed Electron root alias", () => {
  const callers = [
    "apps/desktop-electron/scripts/compose-desktop-artifacts.cjs",
    "apps/desktop-electron/scripts/prepare-package.cjs",
    "apps/desktop-electron/scripts/build-package.cjs",
    "apps/desktop-electron/scripts/check-runtime-budget.cjs",
    "scripts/runtime-source-watch.mjs",
    "apps/web/scripts/sync-file-viewer-assets.mjs",
    "apps/web/scripts/sync-material-icon-theme.mjs",
  ];

  for (const caller of callers) {
    const source = readFileSync(path.join(REPOSITORY_ROOT, caller), "utf8");
    assert.doesNotMatch(source, /\belectronRoot\b/u, caller);
    assert.match(source, /workbench-paths\.cjs/u, caller);
  }
});
