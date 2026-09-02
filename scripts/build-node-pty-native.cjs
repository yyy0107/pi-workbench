const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");

const nativeArtifact = require("../packages/host/artifact-policy/src/runtime-native.cjs");

const REPOSITORY_ROOT = path.resolve(__dirname, "..");
const TERMINAL_SERVER_MANIFEST = path.join(
  REPOSITORY_ROOT,
  "packages",
  "terminal",
  "server",
  "package.json",
);
const SUPPORTED_PLATFORMS = new Set(["darwin", "linux", "win32"]);
const SUPPORTED_ARCHITECTURES = new Set(["arm64", "x64"]);
const EXPECTED_TARGET_ENV = "WORKBENCH_NODE_PTY_EXPECTED_TARGET";

function isPathInside(rootDirectory, candidatePath) {
  const relative = path.relative(path.resolve(rootDirectory), path.resolve(candidatePath));
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function currentLibc() {
  if (process.platform !== "linux") return "none";
  return process.report?.getReport?.().header?.glibcVersionRuntime ? "glibc" : "musl";
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

function targetKey(target) {
  return `${target.platform}-${target.arch}${target.platform === "linux" ? `-${target.libc}` : ""}`;
}

function currentTarget() {
  if (!SUPPORTED_PLATFORMS.has(process.platform)) {
    throw new Error(`node-pty source builds do not support platform ${process.platform}.`);
  }
  if (!SUPPORTED_ARCHITECTURES.has(process.arch)) {
    throw new Error(`node-pty source builds do not support architecture ${process.arch}.`);
  }
  const libc = currentLibc();
  return Object.freeze({
    platform: process.platform,
    arch: process.arch,
    libc,
    targetTriple: targetTriple(process.platform, process.arch, libc),
  });
}

function resolveNodePtyRoot() {
  const requireFromTerminalServer = createRequire(TERMINAL_SERVER_MANIFEST);
  const entrypoint = realpathSync(requireFromTerminalServer.resolve("node-pty"));
  const packageRoot = realpathSync(path.dirname(path.dirname(entrypoint)));
  const manifestPath = realpathSync(path.join(packageRoot, "package.json"));
  if (!isPathInside(REPOSITORY_ROOT, packageRoot)) {
    throw new Error(`node-pty resolved outside the repository: ${packageRoot}.`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.name !== "node-pty" || typeof manifest.version !== "string") {
    throw new Error("The terminal server resolved an invalid node-pty package.");
  }
  return Object.freeze({ manifest, packageRoot });
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function runSourceBuild() {
  const pnpmEntrypoint = process.env.npm_execpath;
  if (!pnpmEntrypoint || !path.isAbsolute(pnpmEntrypoint)) {
    throw new Error("native:pty:build must be launched through the repository pnpm command.");
  }
  const result = spawnSync(process.execPath, [pnpmEntrypoint, "rebuild", "node-pty"], {
    cwd: REPOSITORY_ROOT,
    env: {
      ...process.env,
      npm_config_build_from_source: "true",
      npm_config_runtime: "node",
    },
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`node-pty source build failed with exit code ${result.status ?? "unknown"}.`);
  }
}

function buildManifest(target, nodePty) {
  const expected = nativeArtifact
    .expectedNativeRuntimeFiles(target)
    .filter(({ packageName }) => packageName === "node-pty");
  const files = expected.map((item) => {
    const filePath = path.join(nodePty.packageRoot, ...item.relativePath.split("/"));
    if (!existsSync(filePath) || !lstatSync(filePath).isFile()) {
      throw new Error(`node-pty source build is missing ${item.relativePath}.`);
    }
    const stats = lstatSync(filePath);
    if (item.executable && (stats.mode & 0o111) === 0) {
      throw new Error(`node-pty source build produced non-executable ${item.relativePath}.`);
    }
    return Object.freeze({
      path: item.relativePath,
      size: stats.size,
      sha256: sha256(filePath),
      mode: stats.mode & 0o777,
    });
  });
  return Object.freeze({
    schemaVersion: 1,
    kind: "workbench-node-pty-native-build",
    sourceBuild: true,
    package: Object.freeze({ name: "node-pty", version: nodePty.manifest.version }),
    target,
    files: Object.freeze(files),
  });
}

function manifestPath(target) {
  const configured = process.env[nativeArtifact.NODE_PTY_NATIVE_BUILD_MANIFEST_ENV];
  const expected = path.join(
    REPOSITORY_ROOT,
    ".desktop-build",
    "node-pty-native",
    targetKey(target),
    "node-pty-native-build.json",
  );
  const destination = configured ? path.resolve(configured) : expected;
  if (destination !== expected || !isPathInside(REPOSITORY_ROOT, destination)) {
    throw new Error(`The node-pty native build manifest must be ${expected}.`);
  }
  return destination;
}

function main() {
  const target = currentTarget();
  const expectedTarget = process.env[EXPECTED_TARGET_ENV];
  if (expectedTarget && expectedTarget !== targetKey(target)) {
    throw new Error(
      `${EXPECTED_TARGET_ENV}=${expectedTarget} does not match this Runner (${targetKey(target)}).`,
    );
  }
  const destination = manifestPath(target);
  resolveNodePtyRoot();
  runSourceBuild();
  const nodePty = resolveNodePtyRoot();
  const manifest = buildManifest(target, nodePty);
  mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  rmSync(temporary, { force: true });
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o644,
  });
  renameSync(temporary, destination);
  process.stdout.write(`WORKBENCH_NODE_PTY_NATIVE_BUILD=${destination}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

module.exports = { EXPECTED_TARGET_ENV, buildManifest, currentTarget, targetKey, targetTriple };
