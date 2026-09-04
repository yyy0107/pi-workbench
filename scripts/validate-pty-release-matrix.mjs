import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const expectedTargets = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64-glibc",
  "linux-x64-glibc",
  "win32-arm64",
  "win32-x64",
];
const rootDirectory = path.resolve(process.argv[2] || "release-downloads");
const tag = process.argv[3];
if (!tag?.startsWith("v")) throw new Error("A release tag is required.");

function filesBelow(directory) {
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...filesBelow(entryPath));
    else if (entry.isFile()) output.push(entryPath);
  }
  return output;
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

const allFiles = filesBelow(rootDirectory);
const metadataFiles = allFiles.filter((filePath) =>
  /^release-metadata-.+\.json$/u.test(path.basename(filePath)),
);
const metadata = metadataFiles.map((filePath) => ({
  directory: path.dirname(filePath),
  value: JSON.parse(readFileSync(filePath, "utf8")),
}));
const actualTargets = metadata.map(({ value }) => value.targetKey).sort();
if (JSON.stringify(actualTargets) !== JSON.stringify(expectedTargets)) {
  throw new Error(`Release matrix mismatch: ${actualTargets.join(", ")}.`);
}

const assetNames = new Set();
for (const { directory, value } of metadata) {
  if (
    value.schemaVersion !== 1 ||
    value.kind !== "workbench-pty-release-assets" ||
    value.version !== tag.slice(1) ||
    value.nodePtyVersion !== "1.1.0"
  ) {
    throw new Error(`Invalid release metadata for ${value.targetKey}.`);
  }
  const declared = [
    value.nativeBuild,
    value.runtimeInventories.node,
    value.runtimeInventories.electron,
    value.webRuntimeArchive,
    ...value.electronPackages,
  ];
  for (const asset of declared) {
    if (assetNames.has(asset.filename))
      throw new Error(`Duplicate release asset ${asset.filename}.`);
    assetNames.add(asset.filename);
    const filePath = path.join(directory, asset.filename);
    if (
      !existsSync(filePath) ||
      readFileSync(filePath).length !== asset.size ||
      sha256(filePath) !== asset.sha256
    ) {
      throw new Error(`Release asset checksum mismatch: ${asset.filename}.`);
    }
  }
  const checksumPath = path.join(directory, `SHA256SUMS-${value.targetKey}.txt`);
  if (!existsSync(checksumPath)) throw new Error(`Missing checksum list for ${value.targetKey}.`);
  const checksumEntries = readFileSync(checksumPath, "utf8").trim().split("\n");
  const checksummedNames = [];
  for (const line of checksumEntries) {
    const match = /^([0-9a-f]{64})  (.+)$/u.exec(line.trimEnd());
    if (!match || sha256(path.join(directory, match[2])) !== match[1]) {
      throw new Error(`Invalid checksum entry for ${value.targetKey}: ${line}.`);
    }
    checksummedNames.push(match[2]);
  }
  const expectedChecksummedNames = filesBelow(directory)
    .filter((filePath) => filePath !== checksumPath)
    .map((filePath) => path.basename(filePath))
    .sort();
  if (JSON.stringify(checksummedNames.sort()) !== JSON.stringify(expectedChecksummedNames)) {
    throw new Error(`Checksum list does not cover the exact ${value.targetKey} release tree.`);
  }
}

process.stdout.write(
  `${JSON.stringify({ version: tag.slice(1), targets: actualTargets, assetCount: assetNames.size })}\n`,
);
