const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  assertDesktopArtifactComposition,
  createDesktopArtifactComposition,
  resolveDesktopArtifactLayout,
} = require("../scripts/desktop-artifact-layout.cjs");

function fixture(t, runtimeDirectory = "electron-target") {
  const runtimeRoot = mkdtempSync(path.join(os.tmpdir(), "workbench-desktop-layout-"));
  t.after(() => rmSync(runtimeRoot, { force: true, recursive: true }));
  const rendererManifestPath = path.join(runtimeRoot, "desktop-renderer", "artifact-manifest.json");
  const runtimeManifestPath = path.join(
    runtimeRoot,
    "runtime-node",
    runtimeDirectory,
    "artifact-manifest.json",
  );
  for (const manifestPath of [rendererManifestPath, runtimeManifestPath]) {
    mkdirSync(path.dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, "{}\n");
  }
  writeFileSync(path.join(runtimeRoot, "desktop-artifact-support.cjs"), "module.exports = {};\n");
  const composition = createDesktopArtifactComposition({
    runtimeRoot,
    rendererManifestPath,
    runtimeManifestPath,
  });
  writeFileSync(
    path.join(runtimeRoot, "desktop-artifacts.json"),
    `${JSON.stringify(composition)}\n`,
  );
  return { composition, rendererManifestPath, runtimeManifestPath, runtimeRoot };
}

test("composition contains only renderer and Runtime manifest references", (t) => {
  const value = fixture(t);
  assert.deepEqual(value.composition, {
    schemaVersion: 1,
    artifactKind: "workbench-desktop-artifacts",
    rendererArtifactManifest: "desktop-renderer/artifact-manifest.json",
    runtimeArtifactManifest: "runtime-node/electron-target/artifact-manifest.json",
  });
  assert.throws(
    () => assertDesktopArtifactComposition({ ...value.composition, buildId: "copied-child-field" }),
    /composition manifest is invalid/u,
  );
  assert.throws(
    () =>
      assertDesktopArtifactComposition({
        ...value.composition,
        rendererArtifactManifest: "../renderer/artifact-manifest.json",
      }),
    /composition manifest is invalid/u,
  );
});

for (const runtimeDirectory of ["electron-target", "current"]) {
  test(`resolves both admitted artifacts and the exact support module (${runtimeDirectory})`, async (t) => {
    const value = fixture(t, runtimeDirectory);
    const target = { runtimeFlavor: "electron-node" };
    const calls = [];
    const layout = await resolveDesktopArtifactLayout(value.runtimeRoot, {
      expectedRendererBuildId: "renderer-build",
      expectedTarget: target,
      deriveRuntimeTargetKey: () => "electron-target",
      resolveRenderer: async (options) => {
        calls.push(["renderer", options]);
        return {
          artifactRoot: path.dirname(value.rendererManifestPath),
          manifestPath: value.rendererManifestPath,
          manifest: { buildId: "renderer-build" },
        };
      },
      resolveRuntime: async (options) => {
        calls.push(["runtime", options]);
        return {
          artifactRoot: path.dirname(value.runtimeManifestPath),
          manifestPath: value.runtimeManifestPath,
          manifest: { target },
        };
      },
    });
    assert.equal(layout.supportPath, path.join(value.runtimeRoot, "desktop-artifact-support.cjs"));
    assert.deepEqual(calls, [
      ["renderer", { manifestPath: value.rendererManifestPath, expectedBuildId: "renderer-build" }],
      ["runtime", { manifestPath: value.runtimeManifestPath, expectedTarget: target }],
    ]);
  });
}

test("rejects escaping manifest links before either resolver runs", async (t) => {
  const value = fixture(t);
  const outside = path.join(value.runtimeRoot, "outside.json");
  writeFileSync(outside, "{}\n");
  rmSync(value.rendererManifestPath);
  symlinkSync(outside, value.rendererManifestPath);
  await assert.rejects(
    resolveDesktopArtifactLayout(value.runtimeRoot, {
      resolveRenderer: async () => assert.fail("renderer resolver must not run"),
      resolveRuntime: async () => assert.fail("Runtime resolver must not run"),
    }),
    /Desktop renderer artifact manifest must be a regular file/u,
  );
});
