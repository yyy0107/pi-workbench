require("tsx/cjs");

const { spawnSync } = require("node:child_process");
const {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");

const {
  assertRuntimeArtifactNativeInventory,
  runtimeArtifactTargetKey,
} = require("@workbench/host-contracts/runtime-artifact-manifest");
const nativeArtifact = require("@workbench/host-artifact-policy/runtime-native");
const { runPackageManager } = require("./process-runner.cjs");
const {
  resolveDesktopRuntimeArtifact,
  resolveStagedDesktopRuntimeArtifact,
} = require("./runtime-artifact-admission.cjs");

const NATIVE_RUNTIME_INVENTORY_FILENAME = "native-runtime-inventory.json";
const { NATIVE_RUNTIME_PACKAGES } = nativeArtifact;
const NATIVE_RUNTIME_SOURCE_OWNER = "@workbench/terminal-server";
const NODE_PTY_RELEASE_POLICY = Object.freeze(
  Object.fromEntries(
    ["darwin", "linux", "win32"].map((platform) => [
      platform,
      Object.freeze(nativeArtifact.nodePtyPolicy({ platform })),
    ]),
  ),
);
const SUPPORTED_NATIVE_TARGETS = new Set([
  "darwin-arm64-none",
  "darwin-x64-none",
  "linux-arm64-glibc",
  "linux-arm64-musl",
  "linux-x64-glibc",
  "linux-x64-musl",
  "win32-arm64-none",
  "win32-x64-none",
]);

function targetKey(target) {
  return `${target.platform}-${target.arch}-${target.libc}`;
}

function targetTriple(platform, arch, libc) {
  if (platform === "darwin") {
    return arch === "x64" ? "x86_64-apple-darwin" : "aarch64-apple-darwin";
  }
  if (platform === "win32") {
    return arch === "x64" ? "x86_64-pc-windows-msvc" : "aarch64-pc-windows-msvc";
  }
  const cpu = arch === "x64" ? "x86_64" : "aarch64";
  return `${cpu}-unknown-linux-${libc === "glibc" ? "gnu" : "musl"}`;
}

function assertExactTarget(actual, expected, label = "Electron Runtime artifact target") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} does not match the measured Electron runtime.`);
  }
  return actual;
}

function validateElectronRuntimeTarget(target) {
  if (!target || typeof target !== "object" || target.runtimeFlavor !== "electron-node") {
    throw new Error("Electron Runtime artifact target must use the electron-node flavor.");
  }
  if (!SUPPORTED_NATIVE_TARGETS.has(targetKey(target))) {
    throw new Error(`Unsupported Electron native runtime target: ${targetKey(target)}.`);
  }

  // The contract target-key serializer uses the shared strict target parser.
  runtimeArtifactTargetKey(target);
  return Object.freeze({ ...target });
}

function electronRuntimeTargetFromIdentity(identity) {
  if (!identity || typeof identity !== "object") {
    throw new Error("Electron runtime identity must be an object.");
  }
  const { platform, arch, electronVersion, nodeVersion, libc } = identity;
  const nodeModuleAbi = Number(identity.nodeModuleAbi ?? identity.electronAbi);
  const napiVersion = Number(identity.napiVersion);
  if (!["darwin", "linux", "win32"].includes(platform)) {
    throw new Error(`Unsupported Electron runtime platform: ${String(platform)}.`);
  }
  if (!["arm64", "x64"].includes(arch)) {
    throw new Error(`Unsupported Electron runtime architecture: ${String(arch)}.`);
  }
  for (const [label, version] of [
    ["Electron version", electronVersion],
    ["Electron Node version", nodeVersion],
  ]) {
    if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)) {
      throw new Error(`${label} is invalid.`);
    }
  }
  if (!Number.isSafeInteger(nodeModuleAbi) || nodeModuleAbi < 1) {
    throw new Error("Electron Node module ABI is invalid.");
  }
  if (!Number.isSafeInteger(napiVersion) || napiVersion < 1) {
    throw new Error("Electron N-API version is invalid.");
  }
  const expectedLibc = platform === "linux" ? libc : "none";
  if (
    (platform === "linux" && expectedLibc !== "glibc" && expectedLibc !== "musl") ||
    (platform !== "linux" && libc !== "none")
  ) {
    throw new Error(`Electron runtime libc is invalid: ${String(libc)}.`);
  }
  return validateElectronRuntimeTarget(
    Object.freeze({
      runtimeFlavor: "electron-node",
      platform,
      arch,
      targetTriple: targetTriple(platform, arch, expectedLibc),
      libc: expectedLibc,
      nodeVersion,
      nodeModuleAbi,
      napiVersion,
      electronVersion,
    }),
  );
}

function readElectronRuntimeIdentity({
  electronExecutable = require("electron"),
  environment = process.env,
  spawn = spawnSync,
} = {}) {
  // All ABI-bearing fields are measured inside Electron-as-Node. In particular, never substitute
  // process.versions.node/modules from the build orchestrator: those versions can legitimately
  // differ from Electron's embedded Node runtime.
  const expression = [
    "const libc=process.platform==='linux'",
    "  ? (process.report?.getReport?.().header?.glibcVersionRuntime ? 'glibc' : 'musl')",
    "  : 'none';",
    "JSON.stringify({",
    "  platform:process.platform,arch:process.arch,libc,",
    "  electronVersion:process.versions.electron,",
    "  nodeVersion:process.versions.node,",
    "  nodeModuleAbi:process.versions.modules,",
    "  napiVersion:process.versions.napi",
    "})",
  ].join("");
  const result = spawn(electronExecutable, ["-p", expression], {
    encoding: "utf8",
    env: { ...environment, ELECTRON_RUN_AS_NODE: "1" },
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Electron runtime identity probe failed with exit code ${result.status ?? "unknown"}: ${String(result.stderr ?? "").trim()}`,
    );
  }
  const lines = String(result.stdout ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const jsonLine = lines.findLast((line) => line.startsWith("{") && line.endsWith("}"));
  if (!jsonLine) throw new Error("Electron runtime identity probe returned no JSON payload.");
  let identity;
  try {
    identity = JSON.parse(jsonLine);
  } catch {
    throw new Error("Electron runtime identity probe returned invalid JSON.");
  }
  // Parsing to the shared target here also rejects missing fields and non-numeric ABI versions.
  const target = electronRuntimeTargetFromIdentity(identity);
  return Object.freeze({
    platform: target.platform,
    arch: target.arch,
    libc: target.libc,
    electronVersion: target.electronVersion,
    nodeVersion: target.nodeVersion,
    nodeModuleAbi: String(target.nodeModuleAbi),
    napiVersion: String(target.napiVersion),
  });
}

function resolveInstalledElectronTarget({
  electronExecutable = require("electron"),
  environment = process.env,
  readIdentity = readElectronRuntimeIdentity,
} = {}) {
  return electronRuntimeTargetFromIdentity(readIdentity({ electronExecutable, environment }));
}

function normalizeElectronBuilderTarget(args) {
  const {
    configureBuildCommand,
    createTargets,
    createYargs,
    normalizeOptions,
  } = require("electron-builder/out/builder");
  const parser = configureBuildCommand(createYargs().exitProcess(false));
  let normalizedOptions;
  try {
    normalizedOptions = normalizeOptions(parser.parse(args));
  } catch (error) {
    throw new Error(
      `Electron packaging target arguments are invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (normalizedOptions.prepackaged != null || normalizedOptions.projectDir != null) {
    throw new Error(
      "Electron native staging does not support --prepackaged or an alternate project directory.",
    );
  }
  const config = normalizedOptions.config;
  if (typeof config === "string" || config?.extends != null) {
    throw new Error(
      "Electron native staging does not support an alternate electron-builder configuration.",
    );
  }
  if (config && typeof config === "object") {
    if (config.electronVersion != null || config.electronDist != null) {
      throw new Error(
        "Electron native staging does not support overriding the Electron runtime identity.",
      );
    }
    if ([config.mac?.target, config.linux?.target, config.win?.target].some(Boolean)) {
      throw new Error(
        "Electron native staging does not support overriding platform targets through CLI configuration.",
      );
    }
    if (config.directories?.app != null || config.directories?.output != null) {
      throw new Error(
        "Electron native staging does not support overriding application or output directories through CLI configuration.",
      );
    }
    if (config.files != null || config.extraResources != null || config.afterPack != null) {
      throw new Error(
        "Electron native staging does not support overriding the manifest-preserving packaging boundary through CLI configuration.",
      );
    }
  }
  const platformEntries = [...normalizedOptions.targets.entries()];
  if (platformEntries.length !== 1) {
    const platforms = platformEntries.map(([platform]) => platform.nodeName).join(", ");
    throw new Error(
      `Electron packaging may target only one operating system: ${platforms || "none"}.`,
    );
  }
  const [platform, architectures] = platformEntries[0];
  return { architectures, createTargets, platform };
}

function readProjectElectronBuilderConfig(projectRoot) {
  const externalConfigFiles = [
    "electron-builder.yml",
    "electron-builder.yaml",
    "electron-builder.json",
    "electron-builder.json5",
    "electron-builder.toml",
    "electron-builder.js",
    "electron-builder.cjs",
    "electron-builder.mjs",
    "electron-builder.ts",
  ].filter((filename) => existsSync(path.join(projectRoot, filename)));
  if (externalConfigFiles.length > 0) {
    throw new Error(
      `Electron native staging requires package.json#build and does not allow external builder config files: ${externalConfigFiles.join(", ")}.`,
    );
  }
  const manifest = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  if (manifest.build === undefined) return {};
  if (!manifest.build || typeof manifest.build !== "object" || Array.isArray(manifest.build)) {
    throw new Error("The project electron-builder configuration must be an object.");
  }
  return manifest.build;
}

function assertProjectElectronBuilderConfig(
  config,
  {
    electronTarget,
    projectRoot,
    repositoryRoot,
    expectedAppDirectory = path.join(repositoryRoot, ".electron-build", "app"),
    expectedOutputDirectory = path.join(repositoryRoot, "dist-electron"),
  },
) {
  if (config.extends != null || config.electronDist != null) {
    throw new Error(
      "Electron native staging does not support project-level config extension or electronDist overrides.",
    );
  }
  if (
    !Array.isArray(config.files) ||
    JSON.stringify(config.files).includes("desktop-runtime") ||
    config.extraResources != null ||
    config.afterPack !== "scripts/after-pack.cjs"
  ) {
    throw new Error(
      "Project Electron packaging must keep desktop-runtime out of files/extraResources and materialize it through scripts/after-pack.cjs.",
    );
  }
  if (
    config.electronVersion != null &&
    String(config.electronVersion) !== electronTarget.electronVersion
  ) {
    throw new Error(
      `Project Electron version ${String(config.electronVersion)} does not match installed Electron ${electronTarget.electronVersion}.`,
    );
  }
  const configuredAppDirectory = path.resolve(projectRoot, config.directories?.app ?? ".");
  const configuredOutputDirectory = path.resolve(projectRoot, config.directories?.output ?? "dist");
  const configuredIcon = path.resolve(projectRoot, config.icon ?? "");
  if (configuredAppDirectory !== path.resolve(expectedAppDirectory)) {
    throw new Error(
      `Project electron-builder application directory ${configuredAppDirectory} does not match staged application ${path.resolve(expectedAppDirectory)}.`,
    );
  }
  if (configuredOutputDirectory !== path.resolve(expectedOutputDirectory)) {
    throw new Error(
      `Project electron-builder output directory ${configuredOutputDirectory} does not match budget output ${path.resolve(expectedOutputDirectory)}.`,
    );
  }
  const expectedIcon = path.join(path.resolve(expectedAppDirectory), "public", "app-icon.png");
  if (configuredIcon !== expectedIcon) {
    throw new Error(
      `Project Electron icon ${configuredIcon} does not match the staged manifest-owned icon ${expectedIcon}.`,
    );
  }
}

function resolveNativeTarget(args = [], options = {}) {
  const defaultProjectRoot = path.resolve(__dirname, "..");
  const repositoryRoot = options.repositoryRoot ?? path.resolve(defaultProjectRoot, "..", "..");
  const projectRoot = options.projectRoot ?? path.join(repositoryRoot, "apps", "desktop-electron");
  const normalizedTarget = normalizeElectronBuilderTarget(args);
  const identity =
    options.electronRuntime ??
    readElectronRuntimeIdentity({
      electronExecutable: options.electronExecutable,
      environment: options.environment,
      spawn: options.spawn,
    });
  const electronTarget = electronRuntimeTargetFromIdentity(identity);
  const platform = normalizedTarget.platform.nodeName;
  if (platform !== electronTarget.platform) {
    throw new Error(
      `Cross-OS Electron packaging is unsupported for native runtime dependencies: installed Electron is ${electronTarget.platform}, requested ${platform}.`,
    );
  }
  const architectureEntries = [...normalizedTarget.architectures.keys()];
  if (architectureEntries.length > 1) {
    throw new Error(
      `Electron packaging may target only one architecture; received ${architectureEntries.length}.`,
    );
  }
  if (architectureEntries.length === 1) {
    const electronArchitecture = [
      ...normalizedTarget
        .createTargets([normalizedTarget.platform], null, electronTarget.arch)
        .get(normalizedTarget.platform)
        .keys(),
    ][0];
    if (architectureEntries[0] !== electronArchitecture) {
      throw new Error(
        `Cross-architecture Electron packaging is unsupported for native runtime dependencies: installed Electron is ${electronTarget.arch}.`,
      );
    }
  }
  assertProjectElectronBuilderConfig(
    options.projectBuildConfig ?? readProjectElectronBuilderConfig(projectRoot),
    {
      electronTarget,
      projectRoot,
      repositoryRoot,
      expectedAppDirectory: options.expectedAppDirectory,
      expectedOutputDirectory: options.expectedOutputDirectory,
    },
  );
  return electronTarget;
}

function isPathInside(rootDirectory, candidatePath) {
  return nativeArtifact.isPathInside(rootDirectory, candidatePath);
}

function assertPathInside(rootDirectory, candidatePath, label) {
  return nativeArtifact.assertPathInside(rootDirectory, candidatePath, label);
}

function findPackageRoot(resolvedEntry, packageName) {
  let directory = path.dirname(resolvedEntry);
  while (directory !== path.dirname(directory)) {
    const manifestPath = path.join(directory, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.name === packageName) return directory;
    }
    directory = path.dirname(directory);
  }
  throw new Error(`Could not find package root for ${packageName} from ${resolvedEntry}.`);
}

function assertLocalDependencyDirectory(repositoryRoot, directory, label) {
  const canonicalRepositoryRoot = realpathSync(repositoryRoot);
  const virtualStoreRoot = realpathSync(
    path.join(canonicalRepositoryRoot, "node_modules", ".pnpm"),
  );
  const physicalDirectory = realpathSync(directory);
  assertPathInside(virtualStoreRoot, physicalDirectory, label);
  return physicalDirectory;
}

function assertConfinedDependencyTree(packageDirectory, repositoryRoot, label) {
  const root = assertLocalDependencyDirectory(repositoryRoot, packageDirectory, `${label} root`);
  const visited = new Set();
  function visit(directory) {
    const physicalDirectory = realpathSync(directory);
    if (visited.has(physicalDirectory)) return;
    visited.add(physicalDirectory);
    for (const entry of readdirSync(physicalDirectory, { withFileTypes: true })) {
      const entryPath = path.join(physicalDirectory, entry.name);
      const physicalEntry = realpathSync(entryPath);
      assertPathInside(root, physicalEntry, `${label} file`);
      assertPathInside(repositoryRoot, physicalEntry, `${label} file`);
      if (lstatSync(physicalEntry).isDirectory()) visit(physicalEntry);
    }
  }
  visit(root);
  return root;
}

function resolveTerminalNativePackageDirectory(
  packageName,
  {
    repositoryRoot,
    terminalServerDirectory = path.join(repositoryRoot, "packages", "terminal", "server"),
  },
) {
  if (!NATIVE_RUNTIME_PACKAGES.includes(packageName)) {
    throw new Error(`${packageName} is not owned by ${NATIVE_RUNTIME_SOURCE_OWNER}.`);
  }
  const canonicalRepositoryRoot = realpathSync(repositoryRoot);
  const physicalTerminalServerDirectory = realpathSync(terminalServerDirectory);
  assertPathInside(
    canonicalRepositoryRoot,
    physicalTerminalServerDirectory,
    `${NATIVE_RUNTIME_SOURCE_OWNER} source owner`,
  );
  const ownerManifestPath = path.join(physicalTerminalServerDirectory, "package.json");
  assertPathInside(
    physicalTerminalServerDirectory,
    realpathSync(ownerManifestPath),
    `${NATIVE_RUNTIME_SOURCE_OWNER} manifest`,
  );
  const ownerManifest = JSON.parse(readFileSync(ownerManifestPath, "utf8"));
  if (ownerManifest.name !== NATIVE_RUNTIME_SOURCE_OWNER) {
    throw new Error(`Expected ${ownerManifestPath} to declare ${NATIVE_RUNTIME_SOURCE_OWNER}.`);
  }
  if (typeof ownerManifest.dependencies?.[packageName] !== "string") {
    throw new Error(`${NATIVE_RUNTIME_SOURCE_OWNER} does not declare ${packageName}.`);
  }
  const installedPath = path.join(
    physicalTerminalServerDirectory,
    "node_modules",
    ...packageName.split("/"),
  );
  let packageDirectory;
  if (existsSync(installedPath)) packageDirectory = realpathSync(installedPath);
  else {
    const requireFromOwner = createRequire(ownerManifestPath);
    try {
      packageDirectory = path.dirname(requireFromOwner.resolve(`${packageName}/package.json`));
    } catch (error) {
      if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
      packageDirectory = findPackageRoot(requireFromOwner.resolve(packageName), packageName);
    }
  }
  packageDirectory = assertLocalDependencyDirectory(
    canonicalRepositoryRoot,
    packageDirectory,
    `${packageName} source package`,
  );
  const packageManifestPath = path.join(packageDirectory, "package.json");
  assertPathInside(
    packageDirectory,
    realpathSync(packageManifestPath),
    `${packageName} source manifest`,
  );
  const packageManifest = JSON.parse(readFileSync(packageManifestPath, "utf8"));
  if (packageManifest.name !== packageName) {
    throw new Error(`Resolved ${packageName} to a mismatched package at ${packageDirectory}.`);
  }
  return assertConfinedDependencyTree(
    packageDirectory,
    canonicalRepositoryRoot,
    `${packageName} source package`,
  );
}

function resolveArtifactPackageDirectory(outputDirectory, packageName) {
  const logicalDirectory = path.join(outputDirectory, "node_modules", ...packageName.split("/"));
  const realDirectory = realpathSync(logicalDirectory);
  assertPathInside(outputDirectory, realDirectory, `${packageName} artifact package`);
  const manifestPath = path.join(realDirectory, "package.json");
  assertPathInside(
    realDirectory,
    realpathSync(manifestPath),
    `${packageName} artifact package manifest`,
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.name !== packageName) {
    throw new Error(`Runtime artifact package ${packageName} has the wrong owner.`);
  }
  return realDirectory;
}

function materializeNapiPrebuild(packageName, outputDirectory, repositoryRoot, target) {
  const sourceDirectory = resolveTerminalNativePackageDirectory(packageName, { repositoryRoot });
  const destinationDirectory = resolveArtifactPackageDirectory(outputDirectory, packageName);
  const expected = nativeArtifact
    .expectedNativeRuntimeFiles(target)
    .filter((file) => file.packageName === packageName);
  if (expected.length !== 1) {
    throw new Error(`${packageName} must have exactly one native prebuild policy entry.`);
  }
  const sourcePath = path.join(sourceDirectory, expected[0].relativePath);
  if (!existsSync(sourcePath) || !lstatSync(sourcePath).isFile()) {
    throw new Error(`${packageName} is missing target prebuild ${expected[0].relativePath}.`);
  }
  assertPathInside(sourceDirectory, realpathSync(sourcePath), `${packageName} target prebuild`);
  assertPathInside(repositoryRoot, realpathSync(sourcePath), `${packageName} target prebuild`);
  const sourceTargetDirectory = path.dirname(sourcePath);
  const entries = readdirSync(sourceTargetDirectory, { withFileTypes: true });
  if (
    entries.length !== 1 ||
    entries[0].name !== path.basename(sourcePath) ||
    !entries[0].isFile()
  ) {
    throw new Error(
      `${packageName} must have exactly one ${target.platform}-${target.arch} native winner.`,
    );
  }
  const destinationPath = path.join(destinationDirectory, expected[0].relativePath);
  rmSync(path.join(destinationDirectory, "prebuilds"), { force: true, recursive: true });
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  cpSync(sourcePath, destinationPath);
  chmodSync(destinationPath, lstatSync(sourcePath).mode & 0o777);
}

function createElectronRuntimeArtifactAdapter({
  target: measuredTarget,
  materializePrebuild = materializeNapiPrebuild,
} = {}) {
  const expectedTarget = validateElectronRuntimeTarget(measuredTarget);
  return Object.freeze({
    runtimeFlavor: "electron-node",
    validateTarget(target) {
      assertExactTarget(validateElectronRuntimeTarget(target), expectedTarget);
    },
    materialize({ target, outputDirectory, repositoryRoot }) {
      assertExactTarget(validateElectronRuntimeTarget(target), expectedTarget);
      for (const packageName of ["tree-sitter", "tree-sitter-bash"]) {
        materializePrebuild(packageName, outputDirectory, repositoryRoot, target);
      }
    },
  });
}

async function assertElectronExecutableMatchesTarget(
  expectedTarget,
  {
    electronExecutable = require("electron"),
    environment = process.env,
    readIdentity = readElectronRuntimeIdentity,
  } = {},
) {
  const measured = electronRuntimeTargetFromIdentity(
    readIdentity({ electronExecutable, environment }),
  );
  assertExactTarget(measured, validateElectronRuntimeTarget(expectedTarget));
  return measured;
}

async function buildElectronRuntimeArtifact({
  paths,
  target,
  environment = process.env,
  buildArtifact,
  createAdapter = createElectronRuntimeArtifactAdapter,
  materializerScript = path.join(__dirname, "runtime-artifact-materializer.cjs"),
  run = runPackageManager,
  resolveArtifact = resolveDesktopRuntimeArtifact,
} = {}) {
  if (!paths)
    throw new Error("Workbench paths are required to build an Electron Runtime artifact.");
  const electronTarget = validateElectronRuntimeTarget(target);
  if (buildArtifact) {
    const targetAdapter = createAdapter({ target: electronTarget, environment });
    await buildArtifact({
      target: electronTarget,
      targetAdapter,
      appRoot: paths.runtimeAppRoot,
      repositoryRoot: paths.repositoryRoot,
      outputDirectory: paths.runtimeArtifactRoot,
    });
  } else {
    const request = Object.freeze({
      schemaVersion: 1,
      target: electronTarget,
      outputDirectory: paths.runtimeArtifactRoot,
      materializer: Object.freeze({
        command: process.execPath,
        args: Object.freeze([materializerScript]),
      }),
    });
    run(
      [
        "--filter",
        "@workbench/runtime-node",
        "run",
        "build:artifact",
        "--request-json",
        JSON.stringify(request),
      ],
      {
        cwd: paths.repositoryRoot,
        env: environment,
        label: "Runtime artifact builder",
        stdio: "inherit",
      },
    );
  }
  return resolveArtifact({
    artifactRoot: paths.runtimeArtifactRoot,
    expectedTarget: electronTarget,
  });
}

function expectedLoadedNativePaths(runtimeDirectory, target) {
  return nativeArtifact
    .expectedNativeRuntimeFiles(target)
    .filter((file) => file.selected)
    .map((file) => {
      const packageDirectory = realpathSync(
        path.join(runtimeDirectory, "node_modules", ...file.packageName.split("/")),
      );
      return path
        .relative(runtimeDirectory, realpathSync(path.join(packageDirectory, file.relativePath)))
        .split(path.sep)
        .join("/");
    })
    .sort();
}

async function runStagedNativeSmoke({
  runtimeArtifact,
  runtimeDirectory,
  target,
  electronExecutable = require("electron"),
  environment = process.env,
  smokeScript = path.resolve(__dirname, "../../../scripts/native-runtime-smoke.cjs"),
  spawn = spawnSync,
  readIdentity = readElectronRuntimeIdentity,
  resolveArtifact = resolveDesktopRuntimeArtifact,
} = {}) {
  const expectedTarget = validateElectronRuntimeTarget(target);
  await assertElectronExecutableMatchesTarget(expectedTarget, {
    electronExecutable,
    environment,
    readIdentity,
  });
  const artifact = await resolveStagedDesktopRuntimeArtifact({
    runtimeDirectory,
    runtimeArtifact,
    expectedTarget,
    resolveArtifact,
  });
  assertExactTarget(artifact.manifest.target, expectedTarget);
  const inventory = assertRuntimeArtifactNativeInventory(
    JSON.parse(
      readFileSync(
        path.join(artifact.artifactRoot, artifact.manifest.nativeInventory.path),
        "utf8",
      ),
    ),
  );
  assertExactTarget(inventory.target, expectedTarget, "Native inventory target");
  const result = spawn(electronExecutable, [smokeScript, "--runtime", artifact.artifactRoot], {
    encoding: "utf8",
    env: { ...environment, ELECTRON_RUN_AS_NODE: "1" },
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Staged Electron native smoke failed with exit code ${result.status ?? "unknown"}: ${String(result.stderr ?? result.stdout ?? "").trim()}`,
    );
  }
  const prefix = "WORKBENCH_NATIVE_SMOKE=";
  const payloadLine = String(result.stdout ?? "")
    .split(/\r?\n/u)
    .findLast((line) => line.startsWith(prefix));
  if (!payloadLine) throw new Error("Staged Electron native smoke returned no result payload.");
  const report = JSON.parse(payloadLine.slice(prefix.length));
  assertExactTarget(report.target, expectedTarget, "Native smoke executable target");
  const expected = expectedLoadedNativePaths(artifact.artifactRoot, expectedTarget);
  const actual = [...new Set(report.loadedNativePaths ?? [])].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Staged Electron loaded native paths changed: ${actual.join(", ") || "none"}; expected ${expected.join(", ")}.`,
    );
  }
  return report;
}

module.exports = {
  NATIVE_RUNTIME_INVENTORY_FILENAME,
  NATIVE_RUNTIME_PACKAGES,
  NATIVE_RUNTIME_SOURCE_OWNER,
  NODE_PTY_RELEASE_POLICY,
  SUPPORTED_NATIVE_TARGETS,
  assertElectronExecutableMatchesTarget,
  assertExactTarget,
  assertPathInside,
  assertProjectElectronBuilderConfig,
  buildElectronRuntimeArtifact,
  createElectronRuntimeArtifactAdapter,
  electronRuntimeTargetFromIdentity,
  expectedLoadedNativePaths,
  isPathInside,
  materializeNapiPrebuild,
  normalizeElectronBuilderTarget,
  readElectronRuntimeIdentity,
  resolveInstalledElectronTarget,
  resolveNativeTarget,
  resolveTerminalNativePackageDirectory,
  runStagedNativeSmoke,
  targetTriple,
  validateElectronRuntimeTarget,
};
