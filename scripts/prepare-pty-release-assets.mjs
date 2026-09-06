import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { releaseUpdateInfo } from "./release-update-info.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const supportedTargets = new Set([
  "win32-x64",
  "win32-arm64",
  "darwin-x64",
  "darwin-arm64",
  "linux-x64-glibc",
  "linux-arm64-glibc",
]);
const distributionExtensions = [".deb", ".dmg", ".exe", ".msi", ".rpm", ".zip"];

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}.`);
  return process.argv[index + 1];
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function filesBelow(directory) {
  if (!existsSync(directory)) return [];
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...filesBelow(entryPath));
    else if (entry.isFile()) output.push(entryPath);
  }
  return output;
}

function matchesTarget(target, targetKey) {
  const libc = target.platform === "linux" ? target.libc : undefined;
  const actual = `${target.platform}-${target.arch}${libc ? `-${libc}` : ""}`;
  return actual === targetKey;
}

function readRuntimeArtifact(directory, targetKey, runtimeFlavor) {
  const manifestPath = path.join(directory, "artifact-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    !matchesTarget(manifest.target, targetKey) ||
    manifest.target.runtimeFlavor !== runtimeFlavor
  ) {
    throw new Error(
      `Runtime artifact at ${directory} does not identify ${runtimeFlavor} ${targetKey}.`,
    );
  }
  const inventoryPath = path.join(directory, manifest.nativeInventory.path);
  const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
  if (JSON.stringify(inventory.target) !== JSON.stringify(manifest.target)) {
    throw new Error(`Runtime native inventory target drifted at ${directory}.`);
  }
  for (const file of inventory.files) {
    const filePath = path.join(directory, ...file.path.split("/"));
    const stats = lstatSync(filePath);
    if (
      !stats.isFile() ||
      stats.size !== file.size ||
      (stats.mode & 0o777) !== file.mode ||
      sha256(filePath) !== file.sha256
    ) {
      throw new Error(`Runtime native inventory drifted: ${file.path}.`);
    }
  }
  return { directory, manifest, inventory, inventoryPath };
}

function assertNodePtyMatchesNativeBuild(runtime, nativeManifest) {
  const entries = new Map(
    runtime.inventory.files
      .map((file) => {
        const match = /(?:^|\/)node-pty\/(.+)$/u.exec(file.path);
        return match ? [match[1], file] : undefined;
      })
      .filter(Boolean),
  );
  const expectedPaths = nativeManifest.files.map(({ path: filePath }) => filePath).sort();
  if (JSON.stringify([...entries.keys()].sort()) !== JSON.stringify(expectedPaths)) {
    throw new Error(`Runtime ${runtime.manifest.target.runtimeFlavor} node-pty file set drifted.`);
  }
  for (const expected of nativeManifest.files) {
    const actual = entries.get(expected.path);
    if (
      actual.size !== expected.size ||
      actual.mode !== expected.mode ||
      actual.sha256 !== expected.sha256
    ) {
      throw new Error(`Runtime node-pty hash drifted: ${expected.path}.`);
    }
  }
}

function runtimeArtifacts(targetKey) {
  const manifests = filesBelow(path.join(repositoryRoot, ".desktop-build", "runtime-node"))
    .filter((filePath) => path.basename(filePath) === "artifact-manifest.json")
    .map((manifestPath) => ({
      manifestPath,
      directory: path.dirname(manifestPath),
      manifest: JSON.parse(readFileSync(manifestPath, "utf8")),
    }))
    .filter(({ manifest }) => matchesTarget(manifest.target, targetKey));
  const select = (runtimeFlavor) => {
    const matches = manifests.filter(
      ({ manifest }) => manifest.target.runtimeFlavor === runtimeFlavor,
    );
    if (matches.length !== 1) {
      throw new Error(
        `Expected one ${runtimeFlavor} Runtime artifact for ${targetKey}, found ${matches.length}.`,
      );
    }
    return readRuntimeArtifact(matches[0].directory, targetKey, runtimeFlavor);
  };
  return { node: select("node"), electron: select("electron-node") };
}

function packagedElectronRuntime(targetKey) {
  const candidates = filesBelow(path.join(repositoryRoot, "dist-electron"))
    .filter((filePath) => path.basename(filePath) === "artifact-manifest.json")
    .map((manifestPath) => ({
      directory: path.dirname(manifestPath),
      manifest: JSON.parse(readFileSync(manifestPath, "utf8")),
    }))
    .filter(
      ({ manifest }) =>
        manifest.target?.runtimeFlavor === "electron-node" &&
        matchesTarget(manifest.target, targetKey),
    );
  if (candidates.length !== 1) {
    throw new Error(
      `Expected one unpacked Electron Runtime for ${targetKey}, found ${candidates.length}.`,
    );
  }
  return readRuntimeArtifact(candidates[0].directory, targetKey, "electron-node");
}

function copyReleaseFile(sourcePath, outputDirectory, filename) {
  const destination = path.join(outputDirectory, filename);
  if (existsSync(destination)) throw new Error(`Duplicate release asset name: ${filename}.`);
  copyFileSync(sourcePath, destination);
  return Object.freeze({
    filename,
    sha256: sha256(destination),
    size: lstatSync(destination).size,
  });
}

function packageFiles(sourceDirectory, product, targetKey, outputDirectory) {
  // Only distributables belong in Releases; unpacked application executables are not installers.
  return readdirSync(sourceDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(sourceDirectory, entry.name))
    .filter((filePath) => distributionExtensions.some((extension) => filePath.endsWith(extension)))
    .map((filePath) =>
      copyReleaseFile(
        filePath,
        outputDirectory,
        `${targetKey}-${product}-${path.basename(filePath)}`,
      ),
    );
}

const targetKey = argument("--target");
if (!supportedTargets.has(targetKey)) throw new Error(`Unsupported release target ${targetKey}.`);
const outputDirectory = path.resolve(argument("--output"));
const expectedOutputDirectory = path.join(repositoryRoot, "release-assets", targetKey);
if (outputDirectory !== expectedOutputDirectory) {
  throw new Error(`Release asset output must be ${expectedOutputDirectory}.`);
}

const rootManifest = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
const nativeManifestPath = process.env.WORKBENCH_NODE_PTY_NATIVE_BUILD_MANIFEST;
if (!nativeManifestPath || !existsSync(nativeManifestPath)) {
  throw new Error("WORKBENCH_NODE_PTY_NATIVE_BUILD_MANIFEST must name the verified source build.");
}
const nativeManifest = JSON.parse(readFileSync(nativeManifestPath, "utf8"));
if (
  nativeManifest.kind !== "workbench-node-pty-native-build" ||
  !matchesTarget(nativeManifest.target, targetKey) ||
  nativeManifest.sourceBuild !== true
) {
  throw new Error(`The node-pty native build manifest does not identify ${targetKey}.`);
}

rmSync(outputDirectory, { force: true, recursive: true });
mkdirSync(outputDirectory, { recursive: true });
const runtimes = runtimeArtifacts(targetKey);
const electronPackagedRuntime = packagedElectronRuntime(targetKey);
for (const runtime of [runtimes.node, runtimes.electron, electronPackagedRuntime]) {
  assertNodePtyMatchesNativeBuild(runtime, nativeManifest);
}
const webStandalone = path.join(repositoryRoot, "apps", "web", ".next", "standalone");
if (!existsSync(webStandalone)) throw new Error("The Web standalone artifact has not been built.");
const webArchive = path.join(
  outputDirectory,
  `Pi-Workbench-${rootManifest.version}-web-runtime-${targetKey}.tar.gz`,
);
const tar = spawnSync(
  "tar",
  [
    "-czf",
    webArchive,
    "-C",
    repositoryRoot,
    path.relative(repositoryRoot, webStandalone).split(path.sep).join("/"),
    path.relative(repositoryRoot, runtimes.node.directory).split(path.sep).join("/"),
  ],
  { cwd: repositoryRoot, encoding: "utf8", windowsHide: true },
);
if (tar.error) throw tar.error;
if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr || tar.stdout}`);

const nativeBuild = copyReleaseFile(
  nativeManifestPath,
  outputDirectory,
  `node-pty-native-build-${targetKey}.json`,
);
const nodeInventory = copyReleaseFile(
  path.join(runtimes.node.directory, runtimes.node.manifest.nativeInventory.path),
  outputDirectory,
  `runtime-native-inventory-node-${targetKey}.json`,
);
const electronInventory = copyReleaseFile(
  electronPackagedRuntime.inventoryPath,
  outputDirectory,
  `runtime-native-inventory-electron-${targetKey}.json`,
);
const electronPackages = packageFiles(
  path.join(repositoryRoot, "dist-electron"),
  "electron",
  targetKey,
  outputDirectory,
);
if (electronPackages.length === 0) {
  throw new Error(`Electron must produce a package for ${targetKey}.`);
}
const updateInfo = releaseUpdateInfo({
  targetKey,
  version: rootManifest.version,
  directory: outputDirectory,
  packages: electronPackages,
});
const updateInfoPath = path.join(outputDirectory, updateInfo.filename);
writeFileSync(updateInfoPath, updateInfo.content);
const updateAssets = [
  {
    filename: updateInfo.filename,
    sha256: sha256(updateInfoPath),
    size: lstatSync(updateInfoPath).size,
  },
];

const webRuntimeArchive = Object.freeze({
  filename: path.basename(webArchive),
  sha256: sha256(webArchive),
  size: lstatSync(webArchive).size,
});
const metadata = {
  schemaVersion: 1,
  kind: "workbench-pty-release-assets",
  targetKey,
  version: rootManifest.version,
  nodePtyVersion: nativeManifest.package.version,
  nativeBuild,
  runtimeInventories: { node: nodeInventory, electron: electronInventory },
  webRuntimeArchive,
  electronPackages,
  updateAssets,
};
const metadataPath = path.join(outputDirectory, `release-metadata-${targetKey}.json`);
writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

const checksumFiles = filesBelow(outputDirectory)
  .filter((filePath) => path.basename(filePath) !== `SHA256SUMS-${targetKey}.txt`)
  .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
writeFileSync(
  path.join(outputDirectory, `SHA256SUMS-${targetKey}.txt`),
  `${checksumFiles.map((filePath) => `${sha256(filePath)}  ${path.basename(filePath)}`).join("\n")}\n`,
);
process.stdout.write(`${JSON.stringify(metadata)}\n`);
