const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ELECTRON_RUNTIME_FILES } = require("../scripts/desktop-electron-files.cjs");
const {
  RUNTIME_DYNAMIC_PACKAGES,
  RUNTIME_EXTERNAL_PACKAGES,
  assertDesktopRuntimeBudget,
  findPackagedDesktopLayouts,
  inspectTree,
} = require("../scripts/desktop-runtime-budget.cjs");
const { NATIVE_RUNTIME_PACKAGES } = require("../scripts/native-runtime.cjs");

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

function writeFile(filename, contents = "") {
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, contents);
}

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "workbench-runtime-budget-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const appRoot = path.join(root, "app");
  const runtimeRoot = path.join(appRoot, "desktop-runtime");
  const rendererRoot = path.join(runtimeRoot, "desktop-renderer");
  const runtimeArtifactRoot = path.join(runtimeRoot, "runtime-node", "electron-target");

  writeFile(
    path.join(appRoot, "package.json"),
    `${JSON.stringify({ name: "fixture", version: "1.0.0", main: "electron/main.cjs" })}\n`,
  );
  for (const filename of ELECTRON_RUNTIME_FILES) {
    writeFile(path.join(appRoot, "electron", filename), "module.exports = {};\n");
  }
  writeFile(path.join(appRoot, "public", "app-icon.png"), "icon-fixture\n");
  writeFile(path.join(runtimeRoot, "desktop-artifacts.json"), "{}\n");
  writeFile(path.join(runtimeRoot, "desktop-artifact-support.cjs"), "module.exports = {};\n");
  writeFile(path.join(rendererRoot, "artifact-manifest.json"), "{}\n");
  writeFile(path.join(rendererRoot, "index.html"), "<!doctype html>\n");

  const packageRoot = path.join(
    runtimeArtifactRoot,
    "node_modules",
    ".pnpm",
    "@earendil-works+pi-coding-agent@fixture",
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
  );
  for (const [filename, contents] of [
    ["package.json", '{"name":"@earendil-works/pi-coding-agent","version":"1.0.0"}\n'],
    ["README.md", "README\n"],
    ["docs/guide.md", "guide\n"],
    ["examples/sdk/model-readable.ts", "export {};\n"],
    ["examples/sdk/model-readable.test.ts", "export {};\n"],
  ]) {
    writeFile(path.join(packageRoot, ...filename.split("/")), contents);
  }
  const packageAlias = path.join(
    runtimeArtifactRoot,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
  );
  mkdirSync(path.dirname(packageAlias), { recursive: true });
  symlinkSync(path.relative(path.dirname(packageAlias), packageRoot), packageAlias, "dir");
  writeFile(path.join(runtimeArtifactRoot, "artifact-manifest.json"), "{}\n");
  writeFile(path.join(runtimeArtifactRoot, "runtime-host.cjs"), "module.exports = {};\n");

  const modelReadableResources = [
    "node_modules/.pnpm/@earendil-works+pi-coding-agent@fixture/node_modules/@earendil-works/pi-coding-agent/README.md",
    "node_modules/.pnpm/@earendil-works+pi-coding-agent@fixture/node_modules/@earendil-works/pi-coding-agent/docs/guide.md",
    "node_modules/.pnpm/@earendil-works+pi-coding-agent@fixture/node_modules/@earendil-works/pi-coding-agent/examples/sdk/model-readable.test.ts",
    "node_modules/.pnpm/@earendil-works+pi-coding-agent@fixture/node_modules/@earendil-works/pi-coding-agent/examples/sdk/model-readable.ts",
  ];
  const rendererArtifact = Object.freeze({
    artifactRoot: rendererRoot,
    manifest: Object.freeze({ buildId: "renderer-build" }),
  });
  const runtimeArtifact = Object.freeze({
    artifactRoot: runtimeArtifactRoot,
    entrypoint: path.join(runtimeArtifactRoot, "runtime-host.cjs"),
    manifest: Object.freeze({
      dynamicPackages: [...RUNTIME_DYNAMIC_PACKAGES],
      externalPackages: [...RUNTIME_EXTERNAL_PACKAGES],
      modelReadableResources,
      nativePackages: [...NATIVE_RUNTIME_PACKAGES],
      resources: [...modelReadableResources, "artifact-manifest.json", "runtime-host.cjs"].sort(),
      target: TARGET,
    }),
  });
  return {
    appRoot,
    rendererArtifact,
    rendererRoot,
    runtimeArtifact,
    runtimeArtifactRoot,
    runtimeRoot,
  };
}

test("accepts only the renderer plus one manifest-selected API-only Runtime target", async (t) => {
  const value = fixture(t);
  const calls = [];
  const report = await assertDesktopRuntimeBudget(value.appRoot, undefined, {
    expectedRendererBuildId: "renderer-build",
    expectedTarget: TARGET,
    resolveLayout: async (runtimeDirectory, options) => {
      calls.push({ options, runtimeDirectory });
      return {
        renderer: value.rendererArtifact,
        runtime: value.runtimeArtifact,
      };
    },
  });

  assert.equal(report.rendererArtifact, value.rendererArtifact);
  assert.equal(report.runtimeArtifact, value.runtimeArtifact);
  assert.ok(report.rendererArtifactReport.bytes > 0);
  assert.ok(report.runtimeArtifactReport.bytes > 0);
  assert.deepEqual(
    report.modelReadableResources,
    value.runtimeArtifact.manifest.modelReadableResources,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].runtimeDirectory, value.runtimeRoot);
  assert.equal(calls[0].options.expectedRendererBuildId, "renderer-build");
  assert.equal(calls[0].options.expectedTarget, TARGET);
});

test("rejects source and test payloads in the static renderer", async (t) => {
  const value = fixture(t);
  writeFile(path.join(value.rendererRoot, "leaked.ts"), "export {};\n");
  writeFile(path.join(value.rendererRoot, "fixture.test.js"), "export {};\n");

  await assert.rejects(
    assertDesktopRuntimeBudget(value.appRoot, undefined, {
      resolveLayout: async () => ({
        renderer: value.rendererArtifact,
        runtime: value.runtimeArtifact,
      }),
    }),
    /Desktop renderer TypeScript source files are present.*Desktop renderer test or fixture files are present/su,
  );
});

test("does not classify an ordinary hyphenated asset directory as test code", (t) => {
  const value = fixture(t);
  writeFile(path.join(value.rendererRoot, "assets", "folder-test.svg"), "icon-fixture\n");
  const report = inspectTree(value.rendererRoot);
  assert.equal(report.testFiles.includes("assets/folder-test.svg"), false);
});

test("finds both split and nested packaged desktop layouts", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "workbench-packaged-layouts-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const splitRoot = path.join(root, "split", "resources");
  writeFile(path.join(splitRoot, "app", "package.json"), "{}\n");
  writeFile(path.join(splitRoot, "desktop-runtime", "desktop-artifacts.json"), "{}\n");
  const nestedRoot = path.join(root, "nested", "resources", "app");
  writeFile(path.join(nestedRoot, "package.json"), "{}\n");
  writeFile(path.join(nestedRoot, "desktop-runtime", "desktop-artifacts.json"), "{}\n");

  assert.deepEqual(findPackagedDesktopLayouts(root), [
    {
      appDirectory: nestedRoot,
      runtimeDirectory: path.join(nestedRoot, "desktop-runtime"),
    },
    {
      appDirectory: path.join(splitRoot, "app"),
      runtimeDirectory: path.join(splitRoot, "desktop-runtime"),
    },
  ]);
});
