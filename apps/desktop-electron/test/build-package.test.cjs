const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { createWorkbenchPaths } = require("../../../scripts/workbench-paths.cjs");
const { ARTIFACT_ONLY_RESULT_TYPE, buildPackage } = require("../scripts/build-package.cjs");

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

test("buildPackage validates the staged renderer and API-only Runtime before packaging", async () => {
  const paths = createWorkbenchPaths({
    repositoryRoot: path.resolve("/arbitrary/workbench-repository"),
  });
  const environment = { WORKBENCH_TEST: "1" };
  const calls = [];
  const logs = [];
  const sourceRuntimeArtifact = { artifactRoot: "/source/runtime", manifest: { target: TARGET } };
  const stagedRuntimeArtifact = { artifactRoot: "/staged/runtime", manifest: { target: TARGET } };
  const rendererArtifact = {
    artifactRoot: "/staged/renderer",
    manifest: { buildId: "renderer-build" },
  };
  const report = {
    runtimeReport: {
      fileCount: 3,
      rendererArtifactReport: { bytes: 17 },
      runtimeArtifactReport: { bytes: 25 },
    },
    artifactBytes: undefined,
  };

  const result = await buildPackage({
    paths,
    args: ["--linux", "--dir"],
    environment,
    builderCli: "/virtual/electron-builder.js",
    resolveTarget: (...args) => {
      calls.push(["target", ...args]);
      return TARGET;
    },
    buildRuntimeArtifact: async (options) => {
      calls.push(["buildRuntimeArtifact", options]);
      return sourceRuntimeArtifact;
    },
    prepare: async (options) => {
      calls.push(["prepare", options]);
      return { rendererArtifact, runtimeArtifact: stagedRuntimeArtifact };
    },
    smoke: async (options) => calls.push(["nativeSmoke", options]),
    stagedApiOnlyHostSmoke: async (options) => calls.push(["apiOnlySmoke", options]),
    run: (...args) => calls.push(["run", ...args]),
    packagedAppSmoke: async (options) => calls.push(["packagedAppSmoke", options]),
    assertBudget: async (...args) => {
      calls.push(["budget", ...args]);
      return report;
    },
    log: (message) => logs.push(message),
  });

  assert.equal(result, report);
  assert.deepEqual(calls, [
    [
      "target",
      ["--linux", "--dir"],
      {
        environment,
        expectedAppDirectory: paths.electronAppStagingRoot,
        expectedOutputDirectory: paths.electronOutputRoot,
        projectRoot: paths.desktopElectronRoot,
        repositoryRoot: paths.repositoryRoot,
      },
    ],
    ["buildRuntimeArtifact", { paths, target: TARGET, environment }],
    ["prepare", { paths, target: TARGET, runtimeArtifact: sourceRuntimeArtifact }],
    [
      "nativeSmoke",
      {
        runtimeArtifact: stagedRuntimeArtifact,
        runtimeDirectory: paths.desktopRuntimeArtifactStagingRoot,
        target: TARGET,
        environment,
      },
    ],
    [
      "apiOnlySmoke",
      {
        childWorkingDirectory: paths.desktopRuntimeStagingRoot,
        runtimeArtifact: stagedRuntimeArtifact,
        runtimeDirectory: paths.desktopRuntimeArtifactStagingRoot,
        target: TARGET,
        environment,
      },
    ],
    [
      "run",
      "/virtual/electron-builder.js",
      ["--linux", "--dir"],
      {
        cwd: paths.desktopElectronRoot,
        env: environment,
        label: "electron-builder",
        stdio: "inherit",
      },
    ],
    [
      "packagedAppSmoke",
      {
        outputDirectory: paths.electronOutputRoot,
        target: TARGET,
        expectedRendererBuildId: "renderer-build",
        environment,
      },
    ],
    [
      "budget",
      paths.electronOutputRoot,
      {
        expectedRendererBuildId: "renderer-build",
        expectedTarget: TARGET,
        expectedRuntimeDirectory: paths.desktopRuntimeStagingRoot,
        requireArtifact: false,
      },
    ],
  ]);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /Desktop renderer/u);
  assert.match(logs[0], /Runtime child/u);
  assert.match(logs[0], /manifest-owned Pi model-readable examples/u);
});

test("buildPackage stops before the budget when packaged-app execution fails", async () => {
  const calls = [];
  const expectedFailure = new Error("packaged app smoke failed");
  await assert.rejects(
    buildPackage({
      paths: createWorkbenchPaths({ repositoryRoot: "/repo" }),
      args: ["--linux", "--dir"],
      resolveTarget: () => TARGET,
      buildRuntimeArtifact: async () => ({ artifactRoot: "/source/runtime" }),
      prepare: async () => ({
        rendererArtifact: { manifest: { buildId: "renderer-build" } },
        runtimeArtifact: { artifactRoot: "/staged/runtime", manifest: { target: TARGET } },
      }),
      smoke: async () => calls.push("native-smoke"),
      stagedApiOnlyHostSmoke: async () => calls.push("api-only-smoke"),
      run: () => calls.push("electron-builder"),
      packagedAppSmoke: async () => {
        calls.push("packaged-app-smoke");
        throw expectedFailure;
      },
      assertBudget: () => calls.push("budget"),
    }),
    expectedFailure,
  );
  assert.deepEqual(calls, [
    "native-smoke",
    "api-only-smoke",
    "electron-builder",
    "packaged-app-smoke",
  ]);
});

test("canonical cross-target packaging fails closed while artifact-only validates layout and budget", async () => {
  const paths = createWorkbenchPaths({ repositoryRoot: "/repo" });
  const calls = [];
  const logs = [];
  const crossTarget = { ...TARGET, platform: "darwin", libc: "none" };
  const crossTargetReport = {
    runtimeReport: {
      fileCount: 3,
      rendererArtifactReport: { bytes: 17 },
      runtimeArtifactReport: { bytes: 25 },
    },
  };

  await assert.rejects(
    buildPackage({
      paths,
      args: ["--mac", "--dir"],
      resolveTarget: () => crossTarget,
      buildRuntimeArtifact: async () => assert.fail("canonical not-run must stop before staging"),
    }),
    /cannot pass the required native packaged-app execution smoke/u,
  );

  const result = await buildPackage({
    paths,
    args: ["--mac", "--dir", "--artifact-only"],
    resolveTarget: () => crossTarget,
    buildRuntimeArtifact: async () => ({ artifactRoot: "/source/runtime" }),
    prepare: async () => ({
      rendererArtifact: { manifest: { buildId: "renderer-build" } },
      runtimeArtifact: { artifactRoot: "/staged/runtime", manifest: { target: crossTarget } },
    }),
    smoke: async () => calls.push("native-smoke"),
    stagedApiOnlyHostSmoke: async () => calls.push("api-only-smoke"),
    run: () => calls.push("electron-builder"),
    packagedAppSmoke: async () => assert.fail("Linux smoke must not launch a macOS artifact"),
    assertBudget: async () => {
      calls.push("budget");
      return crossTargetReport;
    },
    log: (message) => logs.push(message),
  });

  assert.deepEqual(result, {
    artifact: crossTargetReport,
    execution: "not-run",
    reason:
      "cross-target artifact; the Linux packaged-app execution contract cannot safely launch it.",
    type: ARTIFACT_ONLY_RESULT_TYPE,
  });
  assert.deepEqual(calls, ["native-smoke", "api-only-smoke", "electron-builder", "budget"]);
  assert.equal(logs.length, 2);
  assert.match(logs[0], /execution smoke not run/u);
});

test("buildPackage rejects an incomplete composition before smoke or packaging", async () => {
  await assert.rejects(
    buildPackage({
      paths: createWorkbenchPaths({ repositoryRoot: "/repo" }),
      args: ["--linux", "--dir"],
      resolveTarget: () => TARGET,
      buildRuntimeArtifact: async () => ({ artifactRoot: "/source" }),
      prepare: async () => ({}),
      smoke: async () => assert.fail("native smoke must not run"),
    }),
    /both manifest-selected artifacts/u,
  );
});
