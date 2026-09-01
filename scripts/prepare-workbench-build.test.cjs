const assert = require("node:assert/strict");
const {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { prepareWorkbenchBuild } = require("./prepare-workbench-build.cjs");
const { createWorkbenchPaths } = require("./workbench-paths.cjs");

test("fresh preparation cleans only the exact app, artifact, and Electron output roots", (t) => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "workbench-build-envelope-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  const paths = createWorkbenchPaths({ repositoryRoot });
  mkdirSync(path.join(paths.runtimeArtifactRoot, "stale-target"), { recursive: true });
  writeFileSync(
    path.join(paths.runtimeArtifactRoot, "stale-target", "artifact-manifest.json"),
    "{}\n",
  );
  const staleRootEntry = path.join(paths.desktopArtifactBuildRoot, "server.mjs");
  writeFileSync(staleRootEntry, "stale\n");
  mkdirSync(paths.webBuildRoot, { recursive: true });
  writeFileSync(path.join(paths.webBuildRoot, "stale-web"), "stale\n");
  mkdirSync(paths.desktopRendererBuildRoot, { recursive: true });
  writeFileSync(path.join(paths.desktopRendererBuildRoot, "stale-renderer-build"), "stale\n");
  mkdirSync(paths.desktopRendererExportRoot, { recursive: true });
  writeFileSync(path.join(paths.desktopRendererExportRoot, "stale-renderer-export"), "stale\n");
  mkdirSync(paths.stagingRoot, { recursive: true });
  writeFileSync(path.join(paths.stagingRoot, "stale-electron"), "stale\n");
  const sibling = path.join(repositoryRoot, "keep.txt");
  writeFileSync(sibling, "keep\n");

  assert.equal(prepareWorkbenchBuild({ paths }), paths.desktopArtifactBuildRoot);
  assert.equal(existsSync(paths.desktopArtifactBuildRoot), true);
  assert.equal(existsSync(staleRootEntry), false);
  assert.equal(existsSync(path.join(paths.runtimeArtifactRoot, "stale-target")), false);
  assert.equal(existsSync(paths.webBuildRoot), false);
  assert.equal(existsSync(paths.desktopRendererBuildRoot), false);
  assert.equal(existsSync(paths.desktopRendererExportRoot), false);
  assert.equal(existsSync(paths.stagingRoot), false);
  assert.equal(existsSync(sibling), true);
});

test("refuses a cleanup root that is broader than the exact build envelope", () => {
  const repositoryRoot = path.resolve("build-cleanup-fixture");
  assert.throws(
    () =>
      prepareWorkbenchBuild({
        paths: {
          repositoryRoot,
          desktopArtifactBuildRoot: repositoryRoot,
          webBuildRoot: path.join(repositoryRoot, "apps", "web", ".next"),
          desktopRendererBuildRoot: path.join(repositoryRoot, "apps", "desktop-renderer", ".next"),
          desktopRendererExportRoot: path.join(repositoryRoot, "apps", "desktop-renderer", "out"),
          stagingRoot: path.join(repositoryRoot, ".electron-build"),
        },
      }),
    /Refusing to clean an unexpected desktop artifact build root/u,
  );
});

test("refuses symlinked cleanup roots without touching their targets", (t) => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "workbench-build-symlink-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  const paths = createWorkbenchPaths({ repositoryRoot });
  const outside = path.join(repositoryRoot, "outside-web-build");
  mkdirSync(path.dirname(paths.webBuildRoot), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(path.join(outside, "sentinel"), "keep\n");
  symlinkSync(outside, paths.webBuildRoot);

  assert.throws(
    () => prepareWorkbenchBuild({ paths }),
    /Refusing to clean through an aliased Web build root/u,
  );
  assert.equal(existsSync(path.join(outside, "sentinel")), true);
});

test("refuses broken symlink cleanup roots without replacing the link", (t) => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "workbench-build-broken-link-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  const paths = createWorkbenchPaths({ repositoryRoot });
  const missingTarget = path.join(repositoryRoot, "missing-web-build");
  mkdirSync(path.dirname(paths.webBuildRoot), { recursive: true });
  symlinkSync(missingTarget, paths.webBuildRoot);

  assert.throws(
    () => prepareWorkbenchBuild({ paths }),
    /Refusing to clean through an aliased Web build root/u,
  );
  assert.equal(existsSync(missingTarget), false);
  assert.equal(lstatSync(paths.webBuildRoot).isSymbolicLink(), true);
});

test("refuses noncanonical repository and output aliases", (t) => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "workbench-build-alias-"));
  t.after(() => rmSync(parent, { force: true, recursive: true }));
  const canonicalRoot = path.join(parent, "repository");
  const aliasRoot = path.join(parent, "repository-link");
  mkdirSync(canonicalRoot, { recursive: true });
  symlinkSync(canonicalRoot, aliasRoot);
  assert.throws(
    () => prepareWorkbenchBuild({ paths: createWorkbenchPaths({ repositoryRoot: aliasRoot }) }),
    /Refusing to clean through an aliased repository root/u,
  );

  const paths = createWorkbenchPaths({ repositoryRoot: canonicalRoot });
  assert.throws(
    () =>
      prepareWorkbenchBuild({
        paths: { ...paths, webBuildRoot: `${paths.webRoot}/./.next` },
      }),
    /Refusing to clean an unexpected Web build root/u,
  );
});
