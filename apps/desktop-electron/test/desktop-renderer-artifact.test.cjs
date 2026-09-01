const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const {
  chmodSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  DESKTOP_RENDERER_ARTIFACT_KIND,
  DESKTOP_RENDERER_ARTIFACT_MANIFEST_SCHEMA_VERSION,
} = require("@workbench/host-contracts/desktop-renderer-artifact-manifest");
const { RUNTIME_HOST_PROTOCOL_VERSION } = require("@workbench/host-contracts/runtime-host-control");
const {
  resolveDesktopRendererArtifact,
  stageDesktopRendererArtifact,
} = require("../scripts/desktop-renderer-artifact.cjs");

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "workbench-electron-renderer-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const artifactRoot = path.join(root, "source");
  const entries = [
    ["404.html", "not found\n"],
    ["__next._tree.txt", "tree\n"],
    ["app-icon.svg", "<svg/>"],
    ["assets/app.js", "export {};\n"],
    ["index.html", '<!doctype html><script src="/assets/app.js"></script>'],
  ];
  for (const [relative, contents] of entries) {
    const filename = path.join(artifactRoot, relative);
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, contents);
    chmodSync(filename, 0o644);
  }
  const files = entries
    .map(([relative]) => {
      const filename = path.join(artifactRoot, relative);
      const stats = lstatSync(filename);
      return {
        path: relative,
        size: stats.size,
        sha256: createHash("sha256").update(readFileSync(filename)).digest("hex"),
        mode: stats.mode & 0o777,
      };
    })
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const manifest = {
    schemaVersion: DESKTOP_RENDERER_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifactKind: DESKTOP_RENDERER_ARTIFACT_KIND,
    applicationVersion: "1.0.0",
    buildId: "renderer-build",
    entrypoint: "index.html",
    staticRoot: ".",
    requiredRuntimeHostProtocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
    resources: files.map((file) => file.path).filter((file) => file !== "index.html"),
    files,
    links: [],
  };
  writeFileSync(path.join(artifactRoot, "artifact-manifest.json"), `${JSON.stringify(manifest)}\n`);
  return { artifactRoot, root };
}

test("admits and stages only the exact schema-1 static renderer inventory", (t) => {
  const value = fixture(t);
  const source = resolveDesktopRendererArtifact({
    artifactRoot: value.artifactRoot,
    expectedBuildId: "renderer-build",
  });
  const staged = stageDesktopRendererArtifact({
    sourceArtifact: source,
    destinationRoot: path.join(value.root, "staged"),
  });
  assert.equal(staged.manifest.buildId, "renderer-build");
  assert.equal(readFileSync(staged.entrypoint, "utf8"), readFileSync(source.entrypoint, "utf8"));

  writeFileSync(path.join(value.artifactRoot, "assets", "app.js"), "mutated\n");
  assert.throws(
    () => resolveDesktopRendererArtifact({ artifactRoot: value.artifactRoot }),
    /inventory does not match/u,
  );
});

test("rejects stale build identity before publication", (t) => {
  const value = fixture(t);
  assert.throws(
    () =>
      resolveDesktopRendererArtifact({
        artifactRoot: value.artifactRoot,
        expectedBuildId: "other-build",
      }),
    /build identity changed/u,
  );
});
