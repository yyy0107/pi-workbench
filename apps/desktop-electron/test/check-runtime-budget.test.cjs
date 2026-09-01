const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createWorkbenchPaths } = require("../../../scripts/workbench-paths.cjs");
const {
  checkDesktopRuntimeBudget,
  resolveDesktopRuntimeBudgetDirectory,
} = require("../scripts/check-runtime-budget.cjs");

const ELECTRON_TARGET = Object.freeze({
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

test("resolves budget targets relative to an injected repository root", () => {
  const paths = createWorkbenchPaths({
    repositoryRoot: path.resolve("/arbitrary/workbench-repository"),
  });

  assert.equal(resolveDesktopRuntimeBudgetDirectory({ paths }), paths.electronAppStagingRoot);
  assert.equal(
    resolveDesktopRuntimeBudgetDirectory({ paths, argument: "custom-output/app" }),
    path.join(paths.repositoryRoot, "custom-output", "app"),
  );
  assert.equal(
    resolveDesktopRuntimeBudgetDirectory({ paths, argument: "/absolute/output/app" }),
    path.resolve("/absolute/output/app"),
  );
});

test("reports renderer and API-only Runtime budgets without claiming zero TypeScript", async () => {
  const messages = [];
  const report = {
    appBytes: 30,
    dependencyPackages: [],
    fileCount: 3,
    modelReadableResources: ["examples/model-readable.ts"],
    rendererArtifactReport: { bytes: 10 },
    runtimeArtifactReport: { bytes: 20 },
  };

  assert.equal(
    await checkDesktopRuntimeBudget({
      assertBudget: async () => report,
      argument: "/virtual/explicit-app",
      target: ELECTRON_TARGET,
      log: (message) => messages.push(message),
    }),
    report,
  );
  assert.equal(messages.length, 1);
  assert.match(messages[0], /renderer=/u);
  assert.match(messages[0], /runtime=/u);
  assert.match(messages[0], /manifest-owned\/model-readable/u);
  assert.doesNotMatch(messages[0], /(?:^|\W)0\s*TS(?:\W|$)/iu);
});

test("default budget binds staging to the current desktop-renderer build", async (t) => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "workbench-budget-identity-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  const paths = createWorkbenchPaths({ repositoryRoot });
  await assert.rejects(
    checkDesktopRuntimeBudget({
      paths,
      assertBudget: async () => assert.fail("budget must not run without staging"),
      resolveRenderer: () => assert.fail("renderer must not resolve without staging"),
    }),
    /Missing staged desktop composition/u,
  );

  mkdirSync(paths.desktopRuntimeStagingRoot, { recursive: true });
  writeFileSync(paths.desktopArtifactCompositionPath, "{}\n");
  const report = {
    appBytes: 1,
    dependencyPackages: [],
    fileCount: 1,
    modelReadableResources: [],
    rendererArtifactReport: { bytes: 1 },
    runtimeArtifactReport: { bytes: 0 },
  };
  let budgetCall;
  await checkDesktopRuntimeBudget({
    paths,
    resolveRenderer: () => ({ manifest: { buildId: "current-renderer-build" } }),
    target: ELECTRON_TARGET,
    assertBudget: async (...args) => {
      budgetCall = args;
      return report;
    },
    log() {},
  });
  assert.deepEqual(budgetCall, [
    paths.electronAppStagingRoot,
    undefined,
    { expectedRendererBuildId: "current-renderer-build", expectedTarget: ELECTRON_TARGET },
  ]);
});
