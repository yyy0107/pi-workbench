const assert = require("node:assert/strict");
const {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createWorkbenchPaths } = require("../../../scripts/workbench-paths.cjs");
const { ELECTRON_RUNTIME_FILES } = require("../scripts/desktop-electron-files.cjs");
const {
  buildDesktopArtifactSupport,
  buildDesktopServices,
  buildPackagedMain,
  buildPackagedPreload,
  buildServerProcessLifecycle,
  preparePackage,
  resetElectronStaging,
  stageRuntimeArtifact,
} = require("../scripts/prepare-package.cjs");

const TARGET = Object.freeze({
  runtimeFlavor: "electron-node",
  platform: "linux",
  arch: "x64",
  targetTriple: "x86_64-unknown-linux-gnu",
  libc: "glibc",
  nodeVersion: "24.18.1",
  nodeModuleAbi: 148,
  napiVersion: 10,
  electronVersion: "43.4.1",
});

function temporaryRepository(t, prefix = "workbench-prepare-package-") {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  return repositoryRoot;
}

test("runtime staging uses a short directory while preserving target and artifact contents", async (t) => {
  const root = temporaryRepository(t);
  const artifactRoot = path.join(root, "electron-node-win32-x64-none-abi148-electron43.4.1");
  const relativeFile =
    "node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/compaction-summary-message.js";
  writeFile(path.join(artifactRoot, relativeFile), "runtime fixture");
  writeFile(path.join(artifactRoot, "artifact-manifest.json"), JSON.stringify({ target: TARGET }));
  const resolvedRoots = [];
  const staged = await stageRuntimeArtifact({
    sourceArtifact: { artifactRoot },
    destinationRoot: path.join(root, "runtime-node"),
    target: TARGET,
    resolveArtifact: async ({ artifactRoot: resolvedRoot }) => {
      resolvedRoots.push(resolvedRoot);
      return {
        artifactRoot: resolvedRoot,
        manifest: JSON.parse(
          readFileSync(path.join(resolvedRoot, "artifact-manifest.json"), "utf8"),
        ),
      };
    },
  });
  assert.equal(path.basename(staged.artifactRoot), "current");
  assert.deepEqual(resolvedRoots, [artifactRoot, staged.artifactRoot]);
  assert.deepEqual(staged.manifest.target, TARGET);
  assert.equal(
    readFileSync(path.join(staged.artifactRoot, relativeFile), "utf8"),
    "runtime fixture",
  );
  const defaultInstallPath = path.win32.join(
    "C:\\Users\\wy777\\AppData\\Local\\Programs\\workbench-ui\\Pi Workbench",
    "resources/desktop-runtime/runtime-node",
    path.basename(staged.artifactRoot),
    relativeFile,
  );
  assert.ok(defaultInstallPath.length < 260);
});

function writeFile(filePath, content = "") {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

test("fresh staging rejects a symlink root without following it", (t) => {
  const repositoryRoot = temporaryRepository(t);
  const paths = createWorkbenchPaths({ repositoryRoot });
  const outside = path.join(repositoryRoot, "outside");
  mkdirSync(outside);
  writeFile(path.join(outside, "sentinel"), "keep\n");
  symlinkSync(outside, paths.stagingRoot);
  assert.throws(() => resetElectronStaging(paths), /symlinked Electron staging root/u);
  assert.equal(readFileSync(path.join(outside, "sentinel"), "utf8"), "keep\n");
});

test("bundles finite packaged support, main, preload, and process cleanup", async (t) => {
  const output = temporaryRepository(t, "workbench-electron-bundles-");
  const paths = createWorkbenchPaths();
  const support = await buildDesktopArtifactSupport({
    paths,
    outfile: path.join(output, "desktop-artifact-support.cjs"),
  });
  await buildDesktopServices({ paths, outfile: path.join(output, "desktop-services.cjs") });
  const main = await buildPackagedMain({ paths, outfile: path.join(output, "main.cjs") });
  const preload = await buildPackagedPreload({ paths, outfile: path.join(output, "preload.cjs") });
  const cleanup = await buildServerProcessLifecycle({
    paths,
    outfile: path.join(output, "server-process-lifecycle.cjs"),
  });

  assert.deepEqual(Object.keys(require(support.outfile)).sort(), [
    "resolveDesktopArtifactLayout",
    "runtimeHostControl",
  ]);
  assert.deepEqual(
    Object.keys(main.result.metafile.inputs).map((item) => item.replaceAll("\\", "/")),
    ["apps/desktop-electron/src/main.cjs"],
  );
  assert.deepEqual(
    Object.keys(preload.result.metafile.inputs)
      .map((item) => item.replaceAll("\\", "/"))
      .sort(),
    ["apps/desktop-electron/src/preload.cjs"],
  );
  assert.doesNotMatch(readFileSync(cleanup.outfile, "utf8"), /@workbench\/host-server/u);
});

test("stages only admitted renderer and Runtime artifacts", async (t) => {
  const repositoryRoot = temporaryRepository(t, "workbench-prepare-integration-");
  const paths = createWorkbenchPaths({ repositoryRoot });
  writeFile(
    path.join(paths.desktopElectronRoot, "package.json"),
    JSON.stringify({
      desktopPackageName: "fixture",
      version: "1.0.0",
      license: "MIT",
      productName: "Fixture",
      desktopName: "fixture.desktop",
    }),
  );
  writeFile(paths.desktopRendererArtifactManifestPath, "{}\n");
  const sourceRenderer = {
    artifactRoot: paths.desktopRendererArtifactRoot,
    manifestPath: paths.desktopRendererArtifactManifestPath,
    manifest: { buildId: "renderer-build", files: [{ path: "app-icon.png" }] },
  };
  const sourceRuntime = {
    artifactRoot: path.join(paths.runtimeArtifactRoot, "electron-target"),
    manifest: { target: TARGET },
  };
  writeFile(path.join(sourceRuntime.artifactRoot, "artifact-manifest.json"), "{}\n");
  for (const file of ELECTRON_RUNTIME_FILES) {
    writeFile(path.join(paths.desktopElectronSourceRoot, file), file);
  }

  let stagedRenderer;
  let stagedRuntime;
  const result = await preparePackage({
    paths,
    target: TARGET,
    runtimeArtifact: sourceRuntime,
    resolveRenderer: () => sourceRenderer,
    async stageRenderer({ destinationRoot }) {
      assert.equal(destinationRoot, paths.desktopRendererArtifactStagingRoot);
      writeFile(path.join(destinationRoot, "artifact-manifest.json"), "{}\n");
      writeFile(path.join(destinationRoot, "app-icon.png"), "icon-fixture\n");
      stagedRenderer = {
        artifactRoot: destinationRoot,
        manifestPath: path.join(destinationRoot, "artifact-manifest.json"),
        manifest: sourceRenderer.manifest,
      };
      return stagedRenderer;
    },
    async stageArtifact({ destinationRoot }) {
      const artifactRoot = path.join(destinationRoot, "electron-target");
      writeFile(path.join(artifactRoot, "artifact-manifest.json"), "{}\n");
      stagedRuntime = {
        artifactRoot,
        manifestPath: path.join(artifactRoot, "artifact-manifest.json"),
        manifest: { target: TARGET },
      };
      return stagedRuntime;
    },
    async buildSupport({ outfile }) {
      writeFile(outfile, "support\n");
    },
    async buildServices({ outfile }) {
      writeFile(outfile, "services\n");
    },
    async buildMain({ outfile }) {
      writeFile(outfile, "main\n");
    },
    async buildPreload({ outfile }) {
      writeFile(outfile, "preload\n");
    },
    async buildProcessLifecycle({ outfile }) {
      writeFile(outfile, "cleanup\n");
    },
    async resolveLayout() {
      return { renderer: stagedRenderer, runtime: stagedRuntime };
    },
    async assertBudget() {
      return {
        rendererArtifactReport: { bytes: 4 },
        runtimeArtifactReport: { bytes: 6 },
        fileCount: 4,
      };
    },
    log: () => undefined,
  });

  assert.equal(result.rendererArtifact, stagedRenderer);
  assert.equal(result.runtimeArtifact, stagedRuntime);
  assert.deepEqual(JSON.parse(readFileSync(paths.desktopArtifactCompositionPath, "utf8")), {
    schemaVersion: 1,
    artifactKind: "workbench-desktop-artifacts",
    rendererArtifactManifest: "desktop-renderer/artifact-manifest.json",
    runtimeArtifactManifest: "runtime-node/electron-target/artifact-manifest.json",
  });
  assert.equal(
    readFileSync(path.join(paths.electronAppStagingRoot, "public", "app-icon.png"), "utf8"),
    "icon-fixture\n",
  );
  assert.equal(existsSync(path.join(paths.desktopRuntimeStagingRoot, "web")), false);
});
