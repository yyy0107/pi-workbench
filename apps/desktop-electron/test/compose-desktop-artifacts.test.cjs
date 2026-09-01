const assert = require("node:assert/strict");
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createWorkbenchPaths } = require("../../../scripts/workbench-paths.cjs");
const { composeDesktopArtifacts } = require("../scripts/compose-desktop-artifacts.cjs");

function fixture(t) {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "workbench-desktop-composition-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  const paths = createWorkbenchPaths({ repositoryRoot });
  const runtimeManifestPath = path.join(
    paths.runtimeArtifactRoot,
    "electron-target",
    "artifact-manifest.json",
  );
  mkdirSync(path.dirname(paths.desktopRendererArtifactManifestPath), { recursive: true });
  mkdirSync(path.dirname(runtimeManifestPath), { recursive: true });
  writeFileSync(paths.desktopRendererArtifactManifestPath, "{}\n");
  writeFileSync(runtimeManifestPath, "{}\n");
  return { paths, runtimeManifestPath };
}

const TARGET = Object.freeze({ targetTriple: "fixture-target" });

test("publishes the exact renderer/Runtime composition after both validate", async (t) => {
  const value = fixture(t);
  const calls = [];
  const result = await composeDesktopArtifacts({
    paths: value.paths,
    buildSupport: async ({ outfile }) => {
      calls.push(["support", outfile]);
      writeFileSync(outfile, "module.exports = {};\n");
    },
    resolveRenderer(options) {
      calls.push(["renderer", options]);
      return {
        artifactRoot: value.paths.desktopRendererArtifactRoot,
        manifestPath: value.paths.desktopRendererArtifactManifestPath,
        manifest: { buildId: "renderer-build" },
      };
    },
    async resolveRuntime(options) {
      calls.push(["runtime", options]);
      return {
        artifactRoot: path.dirname(value.runtimeManifestPath),
        manifestPath: value.runtimeManifestPath,
        manifest: { target: TARGET },
      };
    },
    resolveTarget: () => TARGET,
    log: () => undefined,
  });
  assert.deepEqual(result.composition, {
    schemaVersion: 1,
    artifactKind: "workbench-desktop-artifacts",
    rendererArtifactManifest: "desktop-renderer/artifact-manifest.json",
    runtimeArtifactManifest: "runtime-node/electron-target/artifact-manifest.json",
  });
  assert.deepEqual(
    JSON.parse(readFileSync(value.paths.desktopArtifactCompositionSourcePath, "utf8")),
    result.composition,
  );
  assert.deepEqual(calls.slice(0, 2), [
    ["renderer", { manifestPath: value.paths.desktopRendererArtifactManifestPath }],
    ["runtime", { artifactRoot: value.paths.runtimeArtifactRoot, expectedTarget: TARGET }],
  ]);
});

test("does not publish before Runtime validation and support bundling finish", async (t) => {
  const value = fixture(t);
  await assert.rejects(
    composeDesktopArtifacts({
      paths: value.paths,
      resolveRenderer: () => ({
        manifestPath: value.paths.desktopRendererArtifactManifestPath,
        manifest: { buildId: "renderer-build" },
      }),
      resolveRuntime: async () => {
        throw new Error("multiple Runtime targets");
      },
      resolveTarget: () => TARGET,
      buildSupport: async () => assert.fail("support must not build"),
      log: () => undefined,
    }),
    /multiple Runtime targets/u,
  );
  assert.equal(existsSync(value.paths.desktopArtifactCompositionSourcePath), false);
});
