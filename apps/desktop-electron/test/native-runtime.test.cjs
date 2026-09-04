const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  RUNTIME_ARTIFACT_MANIFEST_FILENAME,
  runtimeArtifactTargetKey,
} = require("@workbench/host-contracts/runtime-artifact-manifest");

const nativeArtifact = require("@workbench/host-artifact-policy/runtime-native");
const {
  materializeElectronRuntimeArtifact,
  parseRuntimeArtifactMaterializationRequest,
} = require("../scripts/runtime-artifact-materializer.cjs");
const {
  NATIVE_RUNTIME_PACKAGES,
  assertExactTarget,
  buildElectronRuntimeArtifact,
  createElectronRuntimeArtifactAdapter,
  electronRuntimeTargetFromIdentity,
  readElectronRuntimeIdentity,
  resolveNativeTarget,
  resolveTerminalNativePackageDirectory,
  runStagedNativeSmoke,
  validateElectronRuntimeTarget,
} = require("../scripts/native-runtime.cjs");

const ELECTRON_IDENTITY = Object.freeze({
  platform: "linux",
  arch: "x64",
  libc: "glibc",
  electronVersion: "43.4.1",
  nodeVersion: "24.18.1",
  nodeModuleAbi: "148",
  napiVersion: "10",
});
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

function temporaryDirectory(t, prefix = "workbench-electron-runtime-") {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  return directory;
}

function writeFixtureFile(filePath, content = filePath, mode) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  if (mode !== undefined) chmodSync(filePath, mode);
}

function writeNativeOwner(repositoryRoot) {
  const owner = path.join(repositoryRoot, "packages", "terminal", "server");
  writeFixtureFile(
    path.join(owner, "package.json"),
    JSON.stringify({
      name: "@workbench/terminal-server",
      version: "1.0.0",
      dependencies: Object.fromEntries(NATIVE_RUNTIME_PACKAGES.map((name) => [name, "1.0.0"])),
    }),
  );
  for (const packageName of NATIVE_RUNTIME_PACKAGES) {
    const packageDirectory = path.join(
      repositoryRoot,
      "node_modules",
      ".pnpm",
      `${packageName.replaceAll("/", "+")}@1.0.0`,
      "node_modules",
      ...packageName.split("/"),
    );
    writeFixtureFile(
      path.join(packageDirectory, "package.json"),
      JSON.stringify({
        name: packageName,
        version: "1.0.0",
      }),
    );
    if (packageName !== "node-pty") {
      const filename = packageName === "tree-sitter" ? "tree-sitter.node" : "tree-sitter-bash.node";
      writeFixtureFile(
        path.join(packageDirectory, "prebuilds", "linux-x64", filename),
        `${packageName}-electron-prebuild`,
        0o644,
      );
    }
    const alias = path.join(owner, "node_modules", ...packageName.split("/"));
    mkdirSync(path.dirname(alias), { recursive: true });
    symlinkSync(path.relative(path.dirname(alias), packageDirectory), alias, "dir");
  }
  return owner;
}

function writeArtifactPackages(artifactRoot) {
  for (const packageName of NATIVE_RUNTIME_PACKAGES) {
    writeFixtureFile(
      path.join(artifactRoot, "node_modules", packageName, "package.json"),
      JSON.stringify({ name: packageName, version: "1.0.0" }),
    );
  }
}

function materializerCandidate(t, prefix = "workbench-materializer-boundary-") {
  const root = temporaryDirectory(t, prefix);
  const repositoryRoot = path.join(root, "repository");
  const producerPid = 4242;
  const outputParent = path.join(repositoryRoot, ".desktop-build", "runtime-node");
  const targetToken = createHash("sha256")
    .update(runtimeArtifactTargetKey(ELECTRON_TARGET))
    .digest("hex")
    .slice(0, 8);
  const outputDirectory = path.join(outputParent, `.t-${targetToken}-${producerPid}-123e4567`);
  mkdirSync(outputDirectory, { recursive: true });
  return Object.freeze({ outputDirectory, outputParent, producerPid, repositoryRoot, root });
}

function parseMaterializerRequest(fixture, overrides = {}) {
  return parseRuntimeArtifactMaterializationRequest(
    [
      "--request-json",
      JSON.stringify({
        schemaVersion: 1,
        target: ELECTRON_TARGET,
        repositoryRoot: fixture.repositoryRoot,
        outputDirectory: fixture.outputDirectory,
        ...overrides,
      }),
    ],
    {
      expectedRepositoryRoot: fixture.repositoryRoot,
      producerPid: fixture.producerPid,
    },
  );
}

test("maps only Electron-as-Node measurements into the artifact target", () => {
  assert.deepEqual(electronRuntimeTargetFromIdentity(ELECTRON_IDENTITY), ELECTRON_TARGET);
  assert.throws(
    () => electronRuntimeTargetFromIdentity({ ...ELECTRON_IDENTITY, nodeVersion: undefined }),
    /Node version is invalid/,
  );
  assert.throws(
    () => electronRuntimeTargetFromIdentity({ ...ELECTRON_IDENTITY, nodeModuleAbi: "host" }),
    /module ABI is invalid/,
  );
});

test("probes Electron's Node version, modules ABI, N-API, target, and libc in one process", () => {
  const calls = [];
  const identity = readElectronRuntimeIdentity({
    electronExecutable: "/virtual/electron",
    environment: { WORKBENCH_TEST: "1" },
    spawn: (...args) => {
      calls.push(args);
      return { status: 0, stderr: "", stdout: `${JSON.stringify(ELECTRON_IDENTITY)}\n` };
    },
  });
  assert.deepEqual(identity, ELECTRON_IDENTITY);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/virtual/electron");
  assert.equal(calls[0][1][0], "-p");
  for (const field of [
    "process.versions.electron",
    "process.versions.node",
    "process.versions.modules",
    "process.versions.napi",
    "glibcVersionRuntime",
  ]) {
    assert.match(calls[0][1][1], new RegExp(field.replaceAll(".", "\\."), "u"));
  }
  assert.equal(calls[0][2].env.ELECTRON_RUN_AS_NODE, "1");
});

test("resolves packaging arguments against installed Electron rather than host Node", () => {
  assert.deepEqual(
    resolveNativeTarget(["--linux", "--x64", "--dir"], {
      electronRuntime: ELECTRON_IDENTITY,
      projectBuildConfig: {
        afterPack: "scripts/after-pack.cjs",
        directories: { app: "../../.electron-build/app", output: "../../dist-electron" },
        files: ["package.json"],
        icon: "../../.electron-build/app/public/app-icon.svg",
      },
    }),
    ELECTRON_TARGET,
  );
  assert.deepEqual(
    resolveNativeTarget(["--linux", "--x64", "--dir"], {
      electronRuntime: ELECTRON_IDENTITY,
      repositoryRoot: path.resolve("/arbitrary/workbench-repository"),
      projectBuildConfig: {
        afterPack: "scripts/after-pack.cjs",
        directories: { app: "../../.electron-build/app", output: "../../dist-electron" },
        files: ["package.json"],
        icon: "../../.electron-build/app/public/app-icon.svg",
      },
    }),
    ELECTRON_TARGET,
  );
  assert.throws(
    () =>
      resolveNativeTarget(["--win", "--dir"], {
        electronRuntime: ELECTRON_IDENTITY,
        projectBuildConfig: {
          afterPack: "scripts/after-pack.cjs",
          directories: { app: "../../.electron-build/app", output: "../../dist-electron" },
          files: ["package.json"],
          icon: "../../.electron-build/app/public/app-icon.svg",
        },
      }),
    /Cross-OS Electron packaging is unsupported/,
  );
  assert.throws(
    () =>
      resolveNativeTarget(["--linux", "--arm64", "--dir"], {
        electronRuntime: ELECTRON_IDENTITY,
        projectBuildConfig: {
          afterPack: "scripts/after-pack.cjs",
          directories: { app: "../../.electron-build/app", output: "../../dist-electron" },
          files: ["package.json"],
          icon: "../../.electron-build/app/public/app-icon.svg",
        },
      }),
    /Cross-architecture Electron packaging is unsupported/,
  );
  assert.throws(
    () =>
      resolveNativeTarget(["--config.electronVersion=42.0.0"], {
        electronRuntime: ELECTRON_IDENTITY,
      }),
    /does not support overriding the Electron runtime identity/,
  );
  assert.throws(
    () =>
      resolveNativeTarget(["--config.afterPack=malicious.cjs"], {
        electronRuntime: ELECTRON_IDENTITY,
      }),
    /does not support overriding the manifest-preserving packaging boundary/,
  );
  assert.throws(
    () =>
      resolveNativeTarget(["--linux", "--x64", "--dir"], {
        electronRuntime: ELECTRON_IDENTITY,
        projectBuildConfig: {
          afterPack: "scripts/after-pack.cjs",
          directories: { app: "../../.electron-build/app", output: "../../dist-electron" },
          files: ["package.json"],
          icon: "public/icon.png",
        },
      }),
    /does not match the staged manifest-owned icon/u,
  );
});

test("Electron adapter reuses node-pty and materializes only parser prebuilds", async (t) => {
  const repositoryRoot = temporaryDirectory(t);
  writeNativeOwner(repositoryRoot);
  const artifactRoot = path.join(repositoryRoot, "artifact");
  writeArtifactPackages(artifactRoot);
  writeFixtureFile(
    path.join(artifactRoot, "node_modules", "node-pty", "build", "Release", "pty.node"),
    "shared-node-api-build",
  );
  const adapter = createElectronRuntimeArtifactAdapter({ target: ELECTRON_TARGET });

  adapter.validateTarget(ELECTRON_TARGET);
  await adapter.materialize({
    target: ELECTRON_TARGET,
    outputDirectory: artifactRoot,
    repositoryRoot,
  });

  assert.equal(
    readFileSync(
      path.join(artifactRoot, "node_modules", "node-pty", "build", "Release", "pty.node"),
      "utf8",
    ),
    "shared-node-api-build",
  );
  assert.equal(existsSync(path.join(artifactRoot, "package.json")), false);
  assert.equal(existsSync(path.join(artifactRoot, "node_modules", "node-addon-api")), false);
  for (const packageName of ["tree-sitter", "tree-sitter-bash"]) {
    const filename = packageName === "tree-sitter" ? "tree-sitter.node" : "tree-sitter-bash.node";
    assert.equal(
      readFileSync(
        path.join(artifactRoot, "node_modules", packageName, "prebuilds", "linux-x64", filename),
        "utf8",
      ),
      `${packageName}-electron-prebuild`,
    );
  }
});

test("adapter rejects target drift before materializing native bytes", () => {
  const adapter = createElectronRuntimeArtifactAdapter({ target: ELECTRON_TARGET });
  assert.throws(
    () => adapter.validateTarget({ ...ELECTRON_TARGET, nodeVersion: "24.18.2" }),
    /does not match the measured Electron runtime/,
  );
  assert.throws(
    () => adapter.validateTarget({ ...ELECTRON_TARGET, runtimeFlavor: "node" }),
    /electron-node flavor/,
  );
});

test("native orchestration has no private manifest reader or Web source resolver", () => {
  const source = readFileSync(path.join(__dirname, "..", "scripts", "native-runtime.cjs"), "utf8");
  assert.doesNotMatch(source, /apps\/web\/src|function readRuntimeArtifactManifest/u);
  assert.doesNotMatch(source, /async function resolveRuntimeArtifact/u);
  assert.doesNotMatch(source, /@electron\/rebuild|electron-rebuild|node-addon-api|\.forge-meta/u);
  assert.match(source, /resolveDesktopRuntimeArtifact/u);
});

test("build helper invokes the Runtime app-owned artifact producer without loading sibling source", async () => {
  const paths = {
    runtimeAppRoot: "/repo/apps/runtime-node",
    repositoryRoot: "/repo",
    runtimeArtifactRoot: "/repo/.desktop-build/runtime-node",
  };
  const descriptor = { artifactRoot: "/artifact", manifest: { target: ELECTRON_TARGET } };
  const calls = [];
  const result = await buildElectronRuntimeArtifact({
    paths,
    target: ELECTRON_TARGET,
    environment: { npm_execpath: "/virtual/pnpm.cjs" },
    materializerScript: "/repo/apps/desktop-electron/scripts/runtime-artifact-materializer.cjs",
    createAdapter: () => {
      throw new Error("the Electron parent process must not construct the target adapter");
    },
    run: (...args) => calls.push(["run", ...args]),
    resolveArtifact: async (options) => {
      calls.push(["resolve", options]);
      return descriptor;
    },
  });
  assert.equal(result, descriptor);
  assert.equal(calls[0][0], "run");
  assert.deepEqual(calls[0][1].slice(0, 5), [
    "--filter",
    "@workbench/runtime-node",
    "run",
    "build:artifact",
    "--request-json",
  ]);
  assert.equal(calls[0][1].includes("--"), false);
  const request = JSON.parse(calls[0][1][5]);
  assert.deepEqual(request, {
    schemaVersion: 1,
    target: ELECTRON_TARGET,
    outputDirectory: paths.runtimeArtifactRoot,
    materializer: {
      command: process.execPath,
      args: ["/repo/apps/desktop-electron/scripts/runtime-artifact-materializer.cjs"],
    },
  });
  assert.deepEqual(calls[0][2], {
    cwd: paths.repositoryRoot,
    env: { npm_execpath: "/virtual/pnpm.cjs" },
    label: "Runtime artifact builder",
    stdio: "inherit",
  });
  assert.deepEqual(calls[1], [
    "resolve",
    { artifactRoot: paths.runtimeArtifactRoot, expectedTarget: ELECTRON_TARGET },
  ]);
});

test("build helper injects the Electron adapter into the shared target-keyed builder", async () => {
  const paths = {
    runtimeAppRoot: "/repo/apps/runtime-node",
    repositoryRoot: "/repo",
    runtimeArtifactRoot: "/repo/.desktop-build/runtime-node",
  };
  const adapter = { runtimeFlavor: "electron-node" };
  const descriptor = { artifactRoot: "/artifact", manifest: { target: ELECTRON_TARGET } };
  const calls = [];
  const result = await buildElectronRuntimeArtifact({
    paths,
    target: ELECTRON_TARGET,
    environment: { WORKBENCH_TEST: "1" },
    createAdapter: (options) => {
      calls.push(["adapter", options]);
      return adapter;
    },
    buildArtifact: async (options) => calls.push(["build", options]),
    resolveArtifact: async (options) => {
      calls.push(["resolve", options]);
      return descriptor;
    },
  });
  assert.equal(result, descriptor);
  assert.equal(calls[1][1].targetAdapter, adapter);
  assert.equal(calls[1][1].outputDirectory, paths.runtimeArtifactRoot);
  assert.deepEqual(calls[2][1], {
    artifactRoot: paths.runtimeArtifactRoot,
    expectedTarget: ELECTRON_TARGET,
  });
});

test("target materializer validates canonical realpath confinement and delegates only native materialization", async (t) => {
  const fixture = materializerCandidate(t);
  const { outputDirectory, repositoryRoot, root } = fixture;
  const outsideDirectory = path.join(root, "outside");
  mkdirSync(outsideDirectory);
  const request = parseMaterializerRequest(fixture);
  const calls = [];
  await materializeElectronRuntimeArtifact({
    request,
    environment: { WORKBENCH_TEST: "1" },
    resolveInstalledTarget: () => ELECTRON_TARGET,
    createAdapter: (options) => {
      calls.push(["create", options]);
      return {
        validateTarget: async (target) => calls.push(["validate", target]),
        materialize: async (context) => calls.push(["materialize", context]),
      };
    },
  });
  assert.deepEqual(calls, [
    ["create", { target: ELECTRON_TARGET, environment: { WORKBENCH_TEST: "1" } }],
    ["validate", ELECTRON_TARGET],
    [
      "materialize",
      {
        target: ELECTRON_TARGET,
        repositoryRoot,
        outputDirectory,
      },
    ],
  ]);
  const escapedOutput = path.join(repositoryRoot, "escaped-output");
  symlinkSync(outsideDirectory, escapedOutput, "dir");
  assert.throws(
    () => parseMaterializerRequest(fixture, { outputDirectory: escapedOutput }),
    /output realpath escapes the runtime artifact/u,
  );

  const repositoryAlias = path.join(root, "repository-alias");
  symlinkSync(repositoryRoot, repositoryAlias, "dir");
  assert.throws(
    () =>
      parseRuntimeArtifactMaterializationRequest(
        [
          "--request-json",
          JSON.stringify({
            schemaVersion: 1,
            target: ELECTRON_TARGET,
            repositoryRoot: repositoryAlias,
            outputDirectory: path.join(
              repositoryAlias,
              path.relative(repositoryRoot, outputDirectory),
            ),
          }),
        ],
        {
          expectedRepositoryRoot: repositoryRoot,
          producerPid: fixture.producerPid,
        },
      ),
    /repository root must use its canonical real path/u,
  );

  const outputAlias = path.join(repositoryRoot, "output-alias");
  symlinkSync(outputDirectory, outputAlias, "dir");
  assert.throws(
    () => parseMaterializerRequest(fixture, { outputDirectory: outputAlias }),
    /output directory must use its canonical real path/u,
  );

  assert.throws(
    () => parseMaterializerRequest(fixture, { outputDirectory: `${outputDirectory}${path.sep}` }),
    /output directory spelling must be canonical/u,
  );
});

test("target materializer request requires its exact versioned object shape", (t) => {
  const fixture = materializerCandidate(t, "workbench-materializer-shape-");
  const valid = {
    schemaVersion: 1,
    target: ELECTRON_TARGET,
    repositoryRoot: fixture.repositoryRoot,
    outputDirectory: fixture.outputDirectory,
  };
  for (const invalid of [
    { ...valid, unexpected: true },
    Object.fromEntries(Object.entries(valid).filter(([key]) => key !== "outputDirectory")),
  ]) {
    assert.throws(
      () =>
        parseRuntimeArtifactMaterializationRequest(["--request-json", JSON.stringify(invalid)], {
          expectedRepositoryRoot: fixture.repositoryRoot,
          producerPid: fixture.producerPid,
        }),
      /must contain exactly/u,
    );
  }
});

test("target materializer admits only the exact producer-owned candidate authority", (t) => {
  const fixture = materializerCandidate(t, "workbench-materializer-authority-");
  const other = materializerCandidate(t, "workbench-materializer-other-repository-");
  assert.throws(
    () =>
      parseRuntimeArtifactMaterializationRequest(
        [
          "--request-json",
          JSON.stringify({
            schemaVersion: 1,
            target: ELECTRON_TARGET,
            repositoryRoot: other.repositoryRoot,
            outputDirectory: other.outputDirectory,
          }),
        ],
        {
          expectedRepositoryRoot: fixture.repositoryRoot,
          producerPid: other.producerPid,
        },
      ),
    /must match the materializer checkout/u,
  );

  const candidateName = path.basename(fixture.outputDirectory);
  const wrongParent = path.join(fixture.repositoryRoot, ".desktop-build", "other", candidateName);
  const finalDirectory = path.join(fixture.outputParent, runtimeArtifactTargetKey(ELECTRON_TARGET));
  const arbitraryDirectory = path.join(fixture.outputParent, ".temporary");
  for (const [directory, error] of [
    [wrongParent, /output parent must be exactly/u],
    [finalDirectory, /exact .* producer candidate/u],
    [arbitraryDirectory, /exact .* producer candidate/u],
  ]) {
    mkdirSync(directory, { recursive: true });
    assert.throws(() => parseMaterializerRequest(fixture, { outputDirectory: directory }), error);
  }

  for (const filename of [RUNTIME_ARTIFACT_MANIFEST_FILENAME, "native-runtime-inventory.json"]) {
    const forbidden = path.join(fixture.outputDirectory, filename);
    writeFileSync(forbidden, "forbidden\n");
    assert.throws(() => parseMaterializerRequest(fixture), new RegExp(filename, "u"));
    rmSync(forbidden);
  }
});

test("target materializer independently rejects drift in every installed Electron target field", async (t) => {
  const fixture = materializerCandidate(t, "workbench-materializer-measurement-");
  const request = parseMaterializerRequest(fixture);
  writeFileSync(path.join(fixture.outputDirectory, "server.mjs"), "export {};\n");
  const drift = {
    runtimeFlavor: "node",
    platform: "darwin",
    arch: "arm64",
    targetTriple: "aarch64-unknown-linux-gnu",
    libc: "musl",
    nodeVersion: "24.18.2",
    nodeModuleAbi: 149,
    napiVersion: 11,
    electronVersion: "43.4.2",
  };
  for (const [field, value] of Object.entries(drift)) {
    let adapterCreations = 0;
    await assert.rejects(
      materializeElectronRuntimeArtifact({
        request,
        resolveInstalledTarget: () => ({ ...ELECTRON_TARGET, [field]: value }),
        createAdapter: () => {
          adapterCreations += 1;
          throw new Error("must not construct adapter after target drift");
        },
      }),
      /does not match the measured Electron runtime/u,
      field,
    );
    assert.equal(adapterCreations, 0, field);
    assert.equal(
      readFileSync(path.join(fixture.outputDirectory, "server.mjs"), "utf8"),
      "export {};\n",
      field,
    );
  }
});

test("native smoke verifies the exact target and exact selected manifest-owned winners", async (t) => {
  const artifactRoot = temporaryDirectory(t);
  writeArtifactPackages(artifactRoot);
  for (const expected of nativeArtifact.expectedNativeRuntimeFiles(ELECTRON_TARGET)) {
    writeFixtureFile(
      path.join(artifactRoot, "node_modules", expected.packageName, expected.relativePath),
      expected.relativePath,
      expected.executable ? 0o755 : 0o644,
    );
  }
  const inventory = {
    schemaVersion: 1,
    target: ELECTRON_TARGET,
    files: nativeArtifact.collectNativeRuntimeInventory(artifactRoot),
  };
  writeFixtureFile(
    path.join(artifactRoot, "native-runtime-inventory.json"),
    JSON.stringify(inventory),
  );
  const descriptor = {
    artifactRoot,
    entrypoint: path.join(artifactRoot, "server.mjs"),
    manifestPath: path.join(artifactRoot, "artifact-manifest.json"),
    manifest: {
      target: ELECTRON_TARGET,
      nativeInventory: { path: "native-runtime-inventory.json" },
    },
  };
  const selectedPaths = nativeArtifact
    .expectedNativeRuntimeFiles(ELECTRON_TARGET)
    .filter((item) => item.selected)
    .map((item) => `node_modules/${item.packageName}/${item.relativePath}`)
    .sort();
  const calls = [];
  const admissionCalls = [];
  const report = await runStagedNativeSmoke({
    runtimeArtifact: descriptor,
    runtimeDirectory: artifactRoot,
    target: ELECTRON_TARGET,
    electronExecutable: "/virtual/electron",
    readIdentity: () => ELECTRON_IDENTITY,
    resolveArtifact: async (options) => {
      admissionCalls.push(options);
      return descriptor;
    },
    spawn: (...args) => {
      calls.push(args);
      return {
        status: 0,
        stderr: "",
        stdout: `WORKBENCH_NATIVE_SMOKE=${JSON.stringify({
          target: ELECTRON_TARGET,
          loadedNativePaths: selectedPaths,
        })}\n`,
      };
    },
  });
  assert.deepEqual(report.loadedNativePaths, selectedPaths);
  assert.deepEqual(admissionCalls, [{ artifactRoot, expectedTarget: ELECTRON_TARGET }]);
  assert.deepEqual(calls[0][1], [
    path.resolve(__dirname, "..", "..", "..", "scripts", "native-runtime-smoke.cjs"),
    "--runtime",
    artifactRoot,
  ]);
  assert.equal(calls[0][2].env.ELECTRON_RUN_AS_NODE, "1");
});

test("native smoke rejects an external descriptor outside the staged selection root", async () => {
  const stagedRoot = path.resolve("staged", "desktop-runtime", "runtime-node");
  const admittedArtifact = {
    artifactRoot: path.join(stagedRoot, "electron-target"),
    manifestPath: path.join(stagedRoot, "electron-target", "artifact-manifest.json"),
    manifest: { target: ELECTRON_TARGET },
  };
  let spawned = false;
  await assert.rejects(
    runStagedNativeSmoke({
      runtimeArtifact: {
        artifactRoot: path.resolve("source", "runtime", "electron-target"),
        manifestPath: path.resolve(
          "source",
          "runtime",
          "electron-target",
          "artifact-manifest.json",
        ),
        manifest: { target: ELECTRON_TARGET },
      },
      runtimeDirectory: stagedRoot,
      target: ELECTRON_TARGET,
      electronExecutable: "/virtual/electron",
      readIdentity: () => ELECTRON_IDENTITY,
      resolveArtifact: async ({ artifactRoot, expectedTarget }) => {
        assert.equal(artifactRoot, stagedRoot);
        assert.deepEqual(expectedTarget, ELECTRON_TARGET);
        return admittedArtifact;
      },
      spawn: () => {
        spawned = true;
        return { status: 0, stderr: "", stdout: "" };
      },
    }),
    /outside the admitted selection root/u,
  );
  assert.equal(spawned, false);
});

test("resolves native packages only from the Terminal Server leaf", (t) => {
  const repositoryRoot = temporaryDirectory(t);
  const owner = writeNativeOwner(repositoryRoot);
  for (const packageName of NATIVE_RUNTIME_PACKAGES) {
    assert.equal(
      resolveTerminalNativePackageDirectory(packageName, { repositoryRoot }),
      realpathSync(path.join(owner, "node_modules", packageName)),
    );
  }
  assert.equal(existsSync(path.join(repositoryRoot, "node_modules", ".pnpm")), true);
});

test("rejects terminal-owned native package links that leave the canonical repository", (t) => {
  const repositoryRoot = temporaryDirectory(t, "workbench-native-source-repository-");
  const externalRoot = temporaryDirectory(t, "workbench-native-source-external-");
  const owner = writeNativeOwner(repositoryRoot);
  const externalPackage = path.join(externalRoot, "node-pty");
  writeFixtureFile(
    path.join(externalPackage, "package.json"),
    JSON.stringify({ name: "node-pty", version: "1.0.0" }),
  );
  const installedPackage = path.join(owner, "node_modules", "node-pty");
  rmSync(installedPackage, { force: true, recursive: true });
  symlinkSync(externalPackage, installedPackage, "dir");
  assert.throws(
    () => resolveTerminalNativePackageDirectory("node-pty", { repositoryRoot }),
    /source package escapes the runtime artifact/u,
  );
});

test("rejects native package ownership outside the canonical pnpm virtual store", (t) => {
  const repositoryRoot = temporaryDirectory(t, "workbench-native-local-store-");
  const owner = writeNativeOwner(repositoryRoot);
  const roguePackage = path.join(repositoryRoot, "node_modules", "rogue", "node-pty");
  writeFixtureFile(
    path.join(roguePackage, "package.json"),
    JSON.stringify({ name: "node-pty", version: "1.0.0" }),
  );
  const installedPackage = path.join(owner, "node_modules", "node-pty");
  rmSync(installedPackage, { force: true, recursive: true });
  symlinkSync(roguePackage, installedPackage, "dir");
  assert.throws(
    () => resolveTerminalNativePackageDirectory("node-pty", { repositoryRoot }),
    /source package escapes the runtime artifact/u,
  );
});

test("rejects a terminal-owned package manifest that escapes its package root", (t) => {
  const repositoryRoot = temporaryDirectory(t, "workbench-native-manifest-repository-");
  const externalRoot = temporaryDirectory(t, "workbench-native-manifest-external-");
  const owner = writeNativeOwner(repositoryRoot);
  const packageManifest = path.join(owner, "node_modules", "tree-sitter", "package.json");
  const externalManifest = path.join(externalRoot, "package.json");
  writeFixtureFile(externalManifest, JSON.stringify({ name: "tree-sitter", version: "1.0.0" }));
  rmSync(packageManifest);
  symlinkSync(externalManifest, packageManifest);
  assert.throws(
    () => resolveTerminalNativePackageDirectory("tree-sitter", { repositoryRoot }),
    /source manifest escapes the runtime artifact/u,
  );
});

test("rejects a terminal-owned native package file that escapes its package root", (t) => {
  const repositoryRoot = temporaryDirectory(t, "workbench-native-file-repository-");
  const externalRoot = temporaryDirectory(t, "workbench-native-file-external-");
  const owner = writeNativeOwner(repositoryRoot);
  const packageDirectory = realpathSync(path.join(owner, "node_modules", "tree-sitter"));
  const externalFile = path.join(externalRoot, "escaped.js");
  writeFixtureFile(externalFile, "module.exports = {};\n");
  symlinkSync(externalFile, path.join(packageDirectory, "escaped.js"));
  assert.throws(
    () => resolveTerminalNativePackageDirectory("tree-sitter", { repositoryRoot }),
    /source package file escapes the runtime artifact/u,
  );
});

test("strict target comparison includes Electron Node version and ABI", () => {
  assert.doesNotThrow(() =>
    assertExactTarget(ELECTRON_TARGET, validateElectronRuntimeTarget(ELECTRON_TARGET)),
  );
  assert.throws(
    () => assertExactTarget(ELECTRON_TARGET, { ...ELECTRON_TARGET, nodeModuleAbi: 137 }),
    /does not match/,
  );
});
