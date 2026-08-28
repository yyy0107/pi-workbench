const assert = require("node:assert/strict");
const { cpSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  DESKTOP_RUNTIME_BUDGET,
  assertDesktopRuntimeBudget,
  assertPackagedOutputBudget,
  inspectDesktopRuntime,
} = require("./desktop-runtime-budget.cjs");

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "workbench-runtime-budget-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  mkdirSync(path.join(root, "desktop-runtime", "node_modules", "next"), { recursive: true });
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "fixture", private: true }),
  );
  writeFileSync(
    path.join(root, "desktop-runtime", "runtime-allowlist.json"),
    JSON.stringify({
      externalPackages: DESKTOP_RUNTIME_BUDGET.requiredExternalPackages,
      dynamicRuntimePackages: DESKTOP_RUNTIME_BUDGET.requiredDynamicRuntimePackages,
      nativeRuntimePackages: DESKTOP_RUNTIME_BUDGET.requiredNativeRuntimePackages,
    }),
  );
  writeFileSync(
    path.join(root, "desktop-runtime", "node_modules", "next", "package.json"),
    JSON.stringify({ name: "next", version: "1.0.0" }),
  );
  return root;
}

test("accepts a source-free runtime within all budgets", (t) => {
  const root = fixture(t);
  const report = assertDesktopRuntimeBudget(root);
  assert.equal(report.fileCount, 3);
  assert.deepEqual(report.dependencyPackages, ["next@1.0.0"]);
});

test("reports maps, TypeScript source, tests, and broken links", (t) => {
  const root = fixture(t);
  const runtime = path.join(root, "desktop-runtime");
  writeFileSync(path.join(runtime, "server.js.map"), "{}");
  writeFileSync(path.join(runtime, "server.ts"), "export {};");
  writeFileSync(path.join(runtime, "server.test.js"), "");
  symlinkSync("missing.js", path.join(runtime, "broken.js"));

  const report = inspectDesktopRuntime(root);
  assert.equal(report.sourceMaps.length, 1);
  assert.equal(report.sourceFiles.length, 1);
  assert.equal(report.testFiles.length, 1);
  assert.equal(report.brokenSymlinks.length, 1);
  assert.throws(() => assertDesktopRuntimeBudget(root), /source maps are present/);
});

test("rejects production and build-only dependencies", (t) => {
  const root = fixture(t);
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "fixture", dependencies: { react: "1.0.0" } }),
  );
  const tsxDirectory = path.join(root, "desktop-runtime", "node_modules", "tsx");
  mkdirSync(tsxDirectory, { recursive: true });
  writeFileSync(
    path.join(tsxDirectory, "package.json"),
    JSON.stringify({ name: "tsx", version: "1.0.0" }),
  );

  assert.throws(
    () => assertDesktopRuntimeBudget(root),
    /must not declare production dependencies[\s\S]*build-only packages entered the runtime/,
  );
});

test("checks the newest packaged app and distribution artifact", (t) => {
  const output = mkdtempSync(path.join(os.tmpdir(), "workbench-packaged-budget-"));
  t.after(() => rmSync(output, { force: true, recursive: true }));
  const appDirectory = path.join(output, "linux-unpacked", "resources", "app");
  mkdirSync(path.dirname(appDirectory), { recursive: true });
  const stagedFixture = fixture(t);
  cpSync(stagedFixture, appDirectory, { recursive: true });
  writeFileSync(path.join(output, "fixture.AppImage"), "artifact");

  const report = assertPackagedOutputBudget(output, { requireArtifact: true });
  assert.equal(report.appDirectory, appDirectory);
  assert.equal(report.artifactBytes, 8);
});
