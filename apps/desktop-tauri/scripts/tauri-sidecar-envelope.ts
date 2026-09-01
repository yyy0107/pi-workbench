import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { constants as fsConstants, type Stats } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  RUNTIME_ARTIFACT_MANIFEST_FILENAME,
  runtimeArtifactTargetKey,
  type NodeRuntimeArtifactTarget,
  type RuntimeArtifactTarget,
} from "@workbench/host-contracts/runtime-artifact-manifest";
import {
  assertRuntimeArtifactTargetMatchesProcess,
  currentRuntimeProcessIdentity,
  resolveRuntimeArtifact,
  type ResolvedRuntimeArtifact,
  type RuntimeArtifactAdmissionPolicy,
  type RuntimeProcessIdentity,
} from "@workbench/host-server/runtime-artifact";

export const TAURI_SIDECAR_ENVELOPE_SCHEMA_VERSION = 1 as const;
export const TAURI_SIDECAR_ENVELOPE_KIND = "workbench-tauri-sidecar-envelope" as const;
export const TAURI_SIDECAR_ENVELOPE_FILENAME = "tauri-sidecar-envelope.json" as const;
/**
 * Records are sorted by unsigned UTF-8 path bytes. A directory hashes as
 * `D\0<path-byte-length>\0<path-bytes>\n`; a file hashes as
 * `F\0<path-byte-length>\0<path-bytes>\0<size-decimal>\0<content-sha256>\n`.
 */
export const MATERIALIZED_TREE_ALGORITHM = "sha256-utf8-path-type-size-content-v1" as const;

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const DESKTOP_TAURI_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
export const REPOSITORY_ROOT = path.resolve(DESKTOP_TAURI_ROOT, "../..");
export const DEFAULT_RUNTIME_ARTIFACT_ROOT = path.join(
  REPOSITORY_ROOT,
  ".desktop-build",
  "runtime-node",
);
export const DEFAULT_TAURI_SOURCE_ROOT = path.join(DESKTOP_TAURI_ROOT, "src-tauri");

const require = createRequire(import.meta.url);
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const PACKAGE_MANAGER_JAVASCRIPT_EXTENSIONS = new Set([".cjs", ".js", ".mjs"]);

interface FileMeasurement {
  readonly mode: number;
  readonly sha256: string;
  readonly size: number;
}

interface TreeDirectoryRecord {
  readonly path: string;
  readonly type: "directory";
}

interface TreeFileRecord {
  readonly path: string;
  readonly type: "file";
  readonly sha256: string;
  readonly size: number;
}

type TreeRecord = TreeDirectoryRecord | TreeFileRecord;

interface NodeModulesPackageLink {
  readonly name: string;
  readonly resolved: string;
  readonly scopeDirectory?: string;
}

interface TreeMaterializationState {
  readonly sourceRoot: string;
  readonly activeDirectories: Set<string>;
  readonly activePackages: Set<string>;
  readonly records: TreeRecord[];
}

export interface MaterializedTreeDigest {
  readonly algorithm: typeof MATERIALIZED_TREE_ALGORITHM;
  readonly sha256: string;
  readonly fileCount: number;
  /** Includes the materialized tree root (`.`). */
  readonly directoryCount: number;
  readonly totalBytes: number;
}

export interface TauriSidecarEnvelope {
  readonly schemaVersion: typeof TAURI_SIDECAR_ENVELOPE_SCHEMA_VERSION;
  readonly kind: typeof TAURI_SIDECAR_ENVELOPE_KIND;
  readonly target: NodeRuntimeArtifactTarget;
  readonly nodeBinary: {
    readonly filename: string;
    readonly size: number;
    readonly sha256: string;
  };
  readonly sourceManifest: {
    readonly filename: typeof RUNTIME_ARTIFACT_MANIFEST_FILENAME;
    readonly size: number;
    readonly sha256: string;
  };
  readonly materializedTree: MaterializedTreeDigest;
}

export interface RuntimeArtifactResolverRequest {
  readonly manifestPath: string;
  readonly processIdentity: RuntimeProcessIdentity;
}

export interface RuntimeArtifactProducerRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
}

export type PublishStep = "backup-runtime" | "backup-binary" | "publish-binary" | "commit-runtime";

export interface StageTauriSidecarOptions {
  readonly repositoryRoot?: string;
  readonly runtimeArtifactRoot?: string;
  readonly tauriSourceRoot?: string;
  readonly nodeExecutable?: string;
  /** Test seam binding an injected executable to the process identity authority. */
  readonly expectedProcessExecutable?: string;
  readonly processIdentity?: RuntimeProcessIdentity;
  readonly probeNodeIdentity?: (executable: string) => Promise<RuntimeProcessIdentity>;
  readonly runProducer?: (request: RuntimeArtifactProducerRequest) => Promise<void>;
  readonly resolveArtifact?: (
    request: RuntimeArtifactResolverRequest,
  ) => Promise<ResolvedRuntimeArtifact>;
  /** Test seam used to simulate a concurrent change after staging but before publication. */
  readonly beforePublish?: () => void | Promise<void>;
  /** Test seam used to prove rollback at each publication boundary. */
  readonly beforePublishStep?: (step: PublishStep) => void | Promise<void>;
  readonly environment?: NodeJS.ProcessEnv;
}

export interface StagedTauriSidecar {
  readonly binaryPath: string;
  readonly runtimeDirectory: string;
  readonly envelopePath: string;
  readonly envelope: TauriSidecarEnvelope;
}

interface FreshPublishedState {
  readonly kind: "fresh";
  readonly snapshot: string;
}

interface ExistingPublishedState {
  readonly kind: "published";
  readonly snapshot: string;
  readonly binaryPath: string;
  readonly envelope: TauriSidecarEnvelope;
}

type PublishedState = FreshPublishedState | ExistingPublishedState;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(compareText);
  const expected = [...keys].sort(compareText);
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function canonicalAbsolutePath(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    !path.isAbsolute(value) ||
    path.normalize(value) !== value ||
    path.resolve(value) !== value
  ) {
    throw new Error(`${label} must be an absolute canonical path without aliases.`);
  }
  return value;
}

function targetTriple(
  platform: NodeRuntimeArtifactTarget["platform"],
  arch: NodeRuntimeArtifactTarget["arch"],
  libc: NodeRuntimeArtifactTarget["libc"],
): string {
  if (platform === "darwin") {
    return arch === "x64" ? "x86_64-apple-darwin" : "aarch64-apple-darwin";
  }
  if (platform === "win32") {
    return arch === "x64" ? "x86_64-pc-windows-msvc" : "aarch64-pc-windows-msvc";
  }
  const cpu = arch === "x64" ? "x86_64" : "aarch64";
  return `${cpu}-unknown-linux-${libc === "glibc" ? "gnu" : "musl"}`;
}

export function nodeTargetFromIdentity(
  identity: RuntimeProcessIdentity,
): NodeRuntimeArtifactTarget {
  if (!isRecord(identity) || identity.runtimeFlavor !== "node") {
    throw new Error("The Tauri sidecar must be staged by a plain Node.js process.");
  }
  if (!(["darwin", "linux", "win32"] as const).includes(identity.platform as never)) {
    throw new Error(`Unsupported Node.js platform: ${String(identity.platform)}.`);
  }
  if (identity.arch !== "arm64" && identity.arch !== "x64") {
    throw new Error(`Unsupported Node.js architecture: ${String(identity.arch)}.`);
  }
  const platform = identity.platform as NodeRuntimeArtifactTarget["platform"];
  const arch = identity.arch;
  const libc = platform === "linux" ? identity.libc : "none";
  if (
    (platform === "linux" && libc !== "glibc" && libc !== "musl") ||
    (platform !== "linux" && identity.libc !== "none")
  ) {
    throw new Error(`Unsupported Node.js libc: ${String(identity.libc)}.`);
  }
  if (!VERSION_PATTERN.test(identity.nodeVersion)) {
    throw new Error("The Node.js version is invalid.");
  }
  if (!Number.isSafeInteger(identity.nodeModuleAbi) || identity.nodeModuleAbi < 1) {
    throw new Error("The Node.js module ABI is invalid.");
  }
  if (!Number.isSafeInteger(identity.napiVersion) || identity.napiVersion < 1) {
    throw new Error("The Node.js N-API version is invalid.");
  }
  const target = Object.freeze({
    runtimeFlavor: "node" as const,
    platform,
    arch,
    targetTriple: targetTriple(platform, arch, libc),
    libc,
    nodeVersion: identity.nodeVersion,
    nodeModuleAbi: identity.nodeModuleAbi,
    napiVersion: identity.napiVersion,
  });
  runtimeArtifactTargetKey(target);
  return target;
}

export function tauriExternalBinaryFilename(target: RuntimeArtifactTarget): string {
  runtimeArtifactTargetKey(target);
  if (target.runtimeFlavor !== "node") {
    throw new Error("The Tauri external binary target must use the node runtime flavor.");
  }
  return `workbench-runtime-node-${target.targetTriple}${target.platform === "win32" ? ".exe" : ""}`;
}

function parseNodeTarget(value: unknown): NodeRuntimeArtifactTarget | undefined {
  if (!isRecord(value)) return undefined;
  try {
    runtimeArtifactTargetKey(value as unknown as RuntimeArtifactTarget);
  } catch {
    return undefined;
  }
  if (value.runtimeFlavor !== "node") return undefined;
  return Object.freeze({
    runtimeFlavor: "node",
    platform: value.platform,
    arch: value.arch,
    targetTriple: value.targetTriple,
    libc: value.libc,
    nodeVersion: value.nodeVersion,
    nodeModuleAbi: value.nodeModuleAbi,
    napiVersion: value.napiVersion,
  }) as NodeRuntimeArtifactTarget;
}

/** Strict parser used by both publication admission and the Rust-facing producer boundary. */
export function parseTauriSidecarEnvelope(value: unknown): TauriSidecarEnvelope | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "kind",
      "target",
      "nodeBinary",
      "sourceManifest",
      "materializedTree",
    ]) ||
    value.schemaVersion !== TAURI_SIDECAR_ENVELOPE_SCHEMA_VERSION ||
    value.kind !== TAURI_SIDECAR_ENVELOPE_KIND
  ) {
    return undefined;
  }
  const target = parseNodeTarget(value.target);
  const nodeBinary = value.nodeBinary;
  const sourceManifest = value.sourceManifest;
  const materializedTree = value.materializedTree;
  if (
    !target ||
    !isRecord(nodeBinary) ||
    !hasExactKeys(nodeBinary, ["filename", "size", "sha256"]) ||
    nodeBinary.filename !== tauriExternalBinaryFilename(target) ||
    !isSafePositiveInteger(nodeBinary.size) ||
    !isSha256(nodeBinary.sha256) ||
    !isRecord(sourceManifest) ||
    !hasExactKeys(sourceManifest, ["filename", "size", "sha256"]) ||
    sourceManifest.filename !== RUNTIME_ARTIFACT_MANIFEST_FILENAME ||
    !isSafePositiveInteger(sourceManifest.size) ||
    !isSha256(sourceManifest.sha256) ||
    !isRecord(materializedTree) ||
    !hasExactKeys(materializedTree, [
      "algorithm",
      "sha256",
      "fileCount",
      "directoryCount",
      "totalBytes",
    ]) ||
    materializedTree.algorithm !== MATERIALIZED_TREE_ALGORITHM ||
    !isSha256(materializedTree.sha256) ||
    !isSafePositiveInteger(materializedTree.fileCount) ||
    !isSafeNonNegativeInteger(materializedTree.directoryCount) ||
    materializedTree.directoryCount < 1 ||
    !isSafePositiveInteger(materializedTree.totalBytes)
  ) {
    return undefined;
  }
  return Object.freeze({
    schemaVersion: TAURI_SIDECAR_ENVELOPE_SCHEMA_VERSION,
    kind: TAURI_SIDECAR_ENVELOPE_KIND,
    target,
    nodeBinary: Object.freeze({
      filename: nodeBinary.filename,
      size: nodeBinary.size,
      sha256: nodeBinary.sha256,
    }),
    sourceManifest: Object.freeze({
      filename: RUNTIME_ARTIFACT_MANIFEST_FILENAME,
      size: sourceManifest.size,
      sha256: sourceManifest.sha256,
    }),
    materializedTree: Object.freeze({
      algorithm: MATERIALIZED_TREE_ALGORITHM,
      sha256: materializedTree.sha256,
      fileCount: materializedTree.fileCount,
      directoryCount: materializedTree.directoryCount,
      totalBytes: materializedTree.totalBytes,
    }),
  });
}

export function serializeTauriSidecarEnvelope(envelope: TauriSidecarEnvelope): string {
  const parsed = parseTauriSidecarEnvelope(envelope);
  if (!parsed) throw new Error("Tauri sidecar envelope is invalid.");
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function stableStatsEqual(
  left: Awaited<ReturnType<Awaited<ReturnType<typeof open>>["stat"]>>,
  right: Awaited<ReturnType<Awaited<ReturnType<typeof open>>["stat"]>>,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

async function measureOrCopyRegularFile(
  source: string,
  {
    destination,
    label,
    confinedRoot,
    executable = false,
  }: {
    readonly destination?: string;
    readonly label: string;
    readonly confinedRoot?: string;
    readonly executable?: boolean;
  },
): Promise<FileMeasurement> {
  const lexical = await lstat(source);
  if (!lexical.isFile() || lexical.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file and not a symbolic link.`);
  }
  const resolved = await realpath(source);
  if (confinedRoot && !isInside(confinedRoot, resolved)) {
    throw new Error(`${label} realpath escapes its admitted root.`);
  }
  const sourceHandle = await open(
    source,
    process.platform === "win32"
      ? fsConstants.O_RDONLY
      : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
  );
  let destinationHandle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const before = await sourceHandle.stat();
    if (!before.isFile()) throw new Error(`${label} changed type while it was opened.`);
    const size = Number(before.size);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error(`${label} is too large to stage safely.`);
    }
    const mode = before.mode & 0o777;
    if (executable && process.platform !== "win32" && (mode & 0o111) === 0) {
      throw new Error(`${label} must be executable.`);
    }
    if (destination) {
      destinationHandle = await open(
        destination,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
        mode,
      );
    }
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(128 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      digest.update(chunk);
      if (destinationHandle) {
        let written = 0;
        while (written < bytesRead) {
          const result = await destinationHandle.write(
            chunk,
            written,
            bytesRead - written,
            position + written,
          );
          if (result.bytesWritten === 0) throw new Error(`${label} copy made no progress.`);
          written += result.bytesWritten;
        }
      }
      position += bytesRead;
    }
    if (position !== size) throw new Error(`${label} changed size while it was copied.`);
    const after = await sourceHandle.stat();
    if (!stableStatsEqual(before, after)) {
      throw new Error(`${label} drifted while it was copied.`);
    }
    if (destinationHandle) {
      await destinationHandle.sync();
      await destinationHandle.close();
      destinationHandle = undefined;
      await chmod(destination!, mode);
    }
    return Object.freeze({ mode, size, sha256: digest.digest("hex") });
  } catch (error) {
    if (destinationHandle) await destinationHandle.close().catch(() => undefined);
    if (destination) await rm(destination, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await sourceHandle.close();
  }
}

function aggregateTreeRecords(records: readonly TreeRecord[]): MaterializedTreeDigest {
  const sorted = [...records].sort((left, right) => compareUtf8(left.path, right.path));
  const seen = new Set<string>();
  const aggregate = createHash("sha256");
  let fileCount = 0;
  let directoryCount = 0;
  let totalBytes = 0;
  for (const record of sorted) {
    if (seen.has(record.path))
      throw new Error(`Materialized tree path is duplicated: ${record.path}.`);
    seen.add(record.path);
    const pathBytes = Buffer.from(record.path, "utf8");
    aggregate.update(record.type === "directory" ? "D\0" : "F\0", "ascii");
    aggregate.update(`${pathBytes.byteLength}\0`, "ascii");
    aggregate.update(pathBytes);
    if (record.type === "file") {
      aggregate.update(`\0${record.size}\0${record.sha256}\n`, "ascii");
      fileCount += 1;
      totalBytes += record.size;
      if (!Number.isSafeInteger(totalBytes)) {
        throw new Error("Materialized tree is too large to describe safely.");
      }
    } else {
      aggregate.update("\n", "ascii");
      directoryCount += 1;
    }
  }
  return Object.freeze({
    algorithm: MATERIALIZED_TREE_ALGORITHM,
    sha256: aggregate.digest("hex"),
    fileCount,
    directoryCount,
    totalBytes,
  });
}

async function canonicalDirectory(directory: string, label: string): Promise<string> {
  canonicalAbsolutePath(directory, label);
  const lexical = await lstat(directory);
  if (!lexical.isDirectory() || lexical.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory.`);
  }
  const resolved = await realpath(directory);
  if (resolved !== directory) throw new Error(`${label} must be canonical.`);
  return resolved;
}

async function optionalLstat(value: string): Promise<Stats | undefined> {
  try {
    return await lstat(value);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function nodeModulesPackageName(value: string): string | undefined {
  const parent = path.dirname(value);
  if (path.basename(parent) === "node_modules") {
    const name = path.basename(value);
    return name.startsWith(".") ? undefined : name;
  }
  const scope = path.basename(parent);
  if (
    scope.startsWith("@") &&
    path.basename(path.dirname(parent)) === "node_modules" &&
    !path.basename(value).startsWith(".")
  ) {
    return `${scope}/${path.basename(value)}`;
  }
  return undefined;
}

function nodeModulesContextForPackage(packageDirectory: string): string | undefined {
  const parent = path.dirname(packageDirectory);
  if (path.basename(parent) === "node_modules") return parent;
  if (
    path.basename(parent).startsWith("@") &&
    path.basename(path.dirname(parent)) === "node_modules"
  ) {
    return path.dirname(parent);
  }
  return undefined;
}

async function resolvePackageLink(
  source: string,
  name: string,
  scopeDirectory: string | undefined,
  state: TreeMaterializationState,
): Promise<NodeModulesPackageLink | undefined> {
  const lexical = await lstat(source);
  if (!lexical.isSymbolicLink()) return undefined;
  await readlink(source);
  let resolved: string;
  try {
    resolved = await realpath(source);
  } catch (error) {
    throw new Error(`Runtime artifact dependency link ${name} is broken or cyclic.`, {
      cause: error,
    });
  }
  if (!isInside(state.sourceRoot, resolved)) {
    throw new Error(`Runtime artifact dependency link ${name} escapes the admitted root.`);
  }
  if (!(await stat(resolved)).isDirectory()) {
    throw new Error(`Runtime artifact dependency link ${name} must resolve to a directory.`);
  }
  return Object.freeze({ name, resolved, scopeDirectory });
}

async function nodeModulesPackageLinks(
  nodeModulesDirectory: string,
  state: TreeMaterializationState,
): Promise<readonly NodeModulesPackageLink[]> {
  const links: NodeModulesPackageLink[] = [];
  const names = await readdir(nodeModulesDirectory);
  names.sort(compareUtf8);
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const source = path.join(nodeModulesDirectory, name);
    const lexical = await lstat(source);
    if (name.startsWith("@") && lexical.isDirectory() && !lexical.isSymbolicLink()) {
      const packageNames = await readdir(source);
      packageNames.sort(compareUtf8);
      for (const packageName of packageNames) {
        if (packageName.startsWith(".")) continue;
        const link = await resolvePackageLink(
          path.join(source, packageName),
          `${name}/${packageName}`,
          source,
          state,
        );
        if (link) links.push(link);
      }
      continue;
    }
    const link = await resolvePackageLink(source, name, undefined, state);
    if (link) links.push(link);
  }
  return Object.freeze(links);
}

function pathUsesPnpmStore(relativePath: string): boolean {
  return (
    relativePath === "node_modules/.pnpm" ||
    relativePath.startsWith("node_modules/.pnpm/") ||
    relativePath.includes("/node_modules/.pnpm/")
  );
}

async function prepareProjectionDirectory(
  destination: string,
  relativePath: string,
  sourceDirectory: string,
  state: TreeMaterializationState,
): Promise<Readonly<{ mode: number }>> {
  const sourceStats = await stat(sourceDirectory);
  if (!sourceStats.isDirectory()) {
    throw new Error(`Runtime artifact dependency context ${relativePath} is not a directory.`);
  }
  const existing = await optionalLstat(destination);
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
    throw new Error(`Runtime artifact dependency projection conflicts at ${relativePath}.`);
  }
  const mode = (existing ?? sourceStats).mode & 0o777;
  if (!existing) {
    await mkdir(destination, { mode: mode | 0o700 });
    state.records.push({ path: relativePath, type: "directory" });
  }
  await chmod(destination, mode | 0o700);
  return Object.freeze({ mode });
}

async function projectPackageDependencies(
  packageDirectory: string,
  destinationDirectory: string,
  relativePath: string,
  visiblePackages: ReadonlyMap<string, string>,
  state: TreeMaterializationState,
): Promise<void> {
  const context = nodeModulesContextForPackage(packageDirectory);
  if (!context || !isInside(state.sourceRoot, context)) return;
  const dependencies = await nodeModulesPackageLinks(context, state);
  const missing = dependencies.filter(
    (dependency) => visiblePackages.get(dependency.name) !== dependency.resolved,
  );
  if (missing.length === 0) return;

  const localVisibility = new Map(visiblePackages);
  for (const dependency of dependencies) {
    localVisibility.set(dependency.name, dependency.resolved);
  }

  const nodeModulesRelative = `${relativePath}/node_modules`;
  const nodeModulesDestination = path.join(destinationDirectory, "node_modules");
  const nodeModules = await prepareProjectionDirectory(
    nodeModulesDestination,
    nodeModulesRelative,
    context,
    state,
  );
  const scopeModes = new Map<string, number>();
  try {
    for (const dependency of missing) {
      let dependencyDestination = nodeModulesDestination;
      let dependencyRelative = nodeModulesRelative;
      const separator = dependency.name.indexOf("/");
      const scope = dependency.name.startsWith("@")
        ? dependency.name.slice(0, separator)
        : undefined;
      const packageName = scope ? dependency.name.slice(separator + 1) : dependency.name;
      if (scope) {
        if (separator <= 1 || packageName.length === 0 || !dependency.scopeDirectory) {
          throw new Error(
            `Runtime artifact dependency package name ${dependency.name} is invalid.`,
          );
        }
        const scopeDestination = path.join(nodeModulesDestination, scope);
        const scopeRelative = `${nodeModulesRelative}/${scope}`;
        if (!scopeModes.has(scope)) {
          const prepared = await prepareProjectionDirectory(
            scopeDestination,
            scopeRelative,
            dependency.scopeDirectory,
            state,
          );
          scopeModes.set(scope, prepared.mode);
        }
        dependencyDestination = scopeDestination;
        dependencyRelative = scopeRelative;
      }
      const packageDestination = path.join(dependencyDestination, packageName);
      const packageRelative = `${dependencyRelative}/${packageName}`;
      if (await optionalLstat(packageDestination)) {
        throw new Error(`Runtime artifact dependency projection conflicts at ${packageRelative}.`);
      }
      await materializePackageLink(
        dependency.resolved,
        packageDestination,
        packageRelative,
        localVisibility,
        state,
      );
    }
  } finally {
    for (const [scope, mode] of scopeModes) {
      await chmod(path.join(nodeModulesDestination, scope), mode);
    }
    await chmod(nodeModulesDestination, nodeModules.mode);
  }
}

async function materializePackageLink(
  resolved: string,
  destination: string,
  relativePath: string,
  visiblePackages: ReadonlyMap<string, string>,
  state: TreeMaterializationState,
): Promise<void> {
  const cyclic = state.activePackages.has(resolved);
  if (!cyclic) state.activePackages.add(resolved);
  try {
    await materializeDirectory(resolved, destination, relativePath, state, visiblePackages);
    if (!cyclic) {
      const mode = (await lstat(destination)).mode & 0o777;
      await chmod(destination, mode | 0o700);
      try {
        await projectPackageDependencies(
          resolved,
          destination,
          relativePath,
          visiblePackages,
          state,
        );
      } finally {
        await chmod(destination, mode);
      }
    }
  } finally {
    if (!cyclic) state.activePackages.delete(resolved);
  }
}

async function materializeDirectory(
  sourceDirectory: string,
  destinationDirectory: string,
  relativePath: string,
  state: TreeMaterializationState,
  visiblePackages: ReadonlyMap<string, string>,
): Promise<void> {
  const resolvedDirectory = await realpath(sourceDirectory);
  if (!isInside(state.sourceRoot, resolvedDirectory)) {
    throw new Error(`Runtime artifact directory ${relativePath} escapes the admitted root.`);
  }
  if (state.activeDirectories.has(resolvedDirectory)) {
    throw new Error(`Runtime artifact symlink cycle reaches ${relativePath}.`);
  }
  const directoryStats = await stat(resolvedDirectory);
  if (!directoryStats.isDirectory()) {
    throw new Error(`Runtime artifact entry ${relativePath} is not a directory.`);
  }
  const mode = directoryStats.mode & 0o777;
  const populationMode = mode | 0o700;
  await mkdir(destinationDirectory, { mode: populationMode });
  await chmod(destinationDirectory, populationMode);
  state.records.push({ path: relativePath, type: "directory" });
  state.activeDirectories.add(resolvedDirectory);
  try {
    let childVisibility = visiblePackages;
    if (path.basename(resolvedDirectory) === "node_modules") {
      const nodeModulesVisibility = new Map(visiblePackages);
      for (const link of await nodeModulesPackageLinks(resolvedDirectory, state)) {
        nodeModulesVisibility.set(link.name, link.resolved);
      }
      childVisibility = nodeModulesVisibility;
    }
    const entries = await readdir(resolvedDirectory);
    entries.sort(compareUtf8);
    for (const name of entries) {
      const childRelative = relativePath === "." ? name : `${relativePath}/${name}`;
      await materializeEntry(
        path.join(resolvedDirectory, name),
        path.join(destinationDirectory, name),
        childRelative,
        state,
        childVisibility,
      );
    }
  } finally {
    state.activeDirectories.delete(resolvedDirectory);
  }
  await chmod(destinationDirectory, mode);
}

async function materializeEntry(
  source: string,
  destination: string,
  relativePath: string,
  state: TreeMaterializationState,
  visiblePackages: ReadonlyMap<string, string>,
): Promise<void> {
  const lexical = await lstat(source);
  let resolved = source;
  if (lexical.isSymbolicLink()) {
    await readlink(source);
    try {
      resolved = await realpath(source);
    } catch (error) {
      throw new Error(`Runtime artifact symlink ${relativePath} is broken or cyclic.`, {
        cause: error,
      });
    }
    if (!isInside(state.sourceRoot, resolved)) {
      throw new Error(`Runtime artifact symlink ${relativePath} escapes the admitted root.`);
    }
  } else {
    resolved = await realpath(source);
    if (!isInside(state.sourceRoot, resolved)) {
      throw new Error(`Runtime artifact entry ${relativePath} escapes the admitted root.`);
    }
  }
  const resolvedStats = await stat(resolved);
  if (resolvedStats.isDirectory()) {
    const packageName = lexical.isSymbolicLink() ? nodeModulesPackageName(source) : undefined;
    if (packageName && !pathUsesPnpmStore(relativePath)) {
      await materializePackageLink(resolved, destination, relativePath, visiblePackages, state);
    } else {
      await materializeDirectory(resolved, destination, relativePath, state, visiblePackages);
    }
    return;
  }
  if (resolvedStats.isFile()) {
    const measurement = await measureOrCopyRegularFile(resolved, {
      destination,
      label: `Runtime artifact file ${relativePath}`,
      confinedRoot: state.sourceRoot,
    });
    state.records.push({
      path: relativePath,
      type: "file",
      size: measurement.size,
      sha256: measurement.sha256,
    });
    return;
  }
  throw new Error(`Runtime artifact contains unsupported special entry ${relativePath}.`);
}

/** Dereferences admitted logical links into a deterministic, entirely link-free resource tree. */
export async function materializeLinkFreeTree(
  sourceRoot: string,
  destinationRoot: string,
): Promise<MaterializedTreeDigest> {
  const canonicalSource = await canonicalDirectory(sourceRoot, "Runtime artifact root");
  canonicalAbsolutePath(destinationRoot, "Materialized Runtime destination");
  if (isInside(canonicalSource, destinationRoot)) {
    throw new Error("Materialized Runtime destination must not be inside the source artifact.");
  }
  const records: TreeRecord[] = [];
  const state: TreeMaterializationState = {
    sourceRoot: canonicalSource,
    activeDirectories: new Set<string>(),
    activePackages: new Set<string>(),
    records,
  };
  try {
    await materializeDirectory(canonicalSource, destinationRoot, ".", state, new Map());
    return aggregateTreeRecords(records);
  } catch (error) {
    await rm(destinationRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function inspectLinkFreeDirectory(
  directory: string,
  relativePath: string,
  excludedPaths: ReadonlySet<string>,
  records: TreeRecord[],
): Promise<void> {
  const directoryStats = await lstat(directory);
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    throw new Error(`Materialized Runtime directory ${relativePath} must be link-free.`);
  }
  records.push({ path: relativePath, type: "directory" });
  const names = await readdir(directory);
  names.sort(compareUtf8);
  for (const name of names) {
    const childRelative = relativePath === "." ? name : `${relativePath}/${name}`;
    if (excludedPaths.has(childRelative)) continue;
    const child = path.join(directory, name);
    const childStats = await lstat(child);
    if (childStats.isSymbolicLink()) {
      throw new Error(`Materialized Runtime entry ${childRelative} must not be a symbolic link.`);
    }
    if (childStats.isDirectory()) {
      await inspectLinkFreeDirectory(child, childRelative, excludedPaths, records);
    } else if (childStats.isFile()) {
      const measurement = await measureOrCopyRegularFile(child, {
        label: `Materialized Runtime file ${childRelative}`,
      });
      records.push({
        path: childRelative,
        type: "file",
        size: measurement.size,
        sha256: measurement.sha256,
      });
    } else {
      throw new Error(`Materialized Runtime contains unsupported special entry ${childRelative}.`);
    }
  }
}

export async function digestLinkFreeTree(
  root: string,
  { exclude = [] as readonly string[] }: { readonly exclude?: readonly string[] } = {},
): Promise<MaterializedTreeDigest> {
  await canonicalDirectory(root, "Materialized Runtime root");
  const records: TreeRecord[] = [];
  await inspectLinkFreeDirectory(root, ".", new Set(exclude), records);
  return aggregateTreeRecords(records);
}

function exactDigest(left: MaterializedTreeDigest, right: MaterializedTreeDigest): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactTarget(left: RuntimeArtifactTarget, right: RuntimeArtifactTarget): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseProbedIdentity(value: unknown): RuntimeProcessIdentity {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "runtimeFlavor",
      "platform",
      "arch",
      "libc",
      "nodeVersion",
      "nodeModuleAbi",
      "napiVersion",
    ])
  ) {
    throw new Error("Node.js executable identity probe returned an invalid shape.");
  }
  const identity = Object.freeze({
    runtimeFlavor: value.runtimeFlavor,
    platform: value.platform,
    arch: value.arch,
    libc: value.libc,
    nodeVersion: value.nodeVersion,
    nodeModuleAbi: value.nodeModuleAbi,
    napiVersion: value.napiVersion,
  }) as RuntimeProcessIdentity;
  nodeTargetFromIdentity(identity);
  return identity;
}

export async function probeNodeExecutableIdentity(
  executable: string,
): Promise<RuntimeProcessIdentity> {
  const expression = [
    "const report=process.report?.getReport?.();",
    "const libc=process.platform==='linux'",
    "  ? (report?.header?.glibcVersionRuntime ? 'glibc' : 'musl') : 'none';",
    "JSON.stringify({runtimeFlavor:process.versions.electron?'electron-node':'node',",
    "platform:process.platform,arch:process.arch,libc,nodeVersion:process.versions.node,",
    "nodeModuleAbi:Number(process.versions.modules),napiVersion:Number(process.versions.napi)})",
  ].join("");
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      executable,
      ["-p", expression],
      {
        encoding: "utf8",
        env: { ...process.env, NODE_OPTIONS: "" },
        timeout: 15_000,
        windowsHide: true,
        maxBuffer: 64 * 1024,
      },
      (error, output, stderr) => {
        if (error) {
          reject(
            new Error(
              `Node.js executable identity probe failed: ${String(stderr).trim() || error.message}`,
              { cause: error },
            ),
          );
          return;
        }
        resolve(output);
      },
    );
  });
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length !== 1) throw new Error("Node.js executable identity probe was ambiguous.");
  let value: unknown;
  try {
    value = JSON.parse(lines[0]);
  } catch (error) {
    throw new Error("Node.js executable identity probe returned invalid JSON.", { cause: error });
  }
  return parseProbedIdentity(value);
}

async function assertProcessExecutable(
  executable: string,
  expectedExecutable: string,
): Promise<void> {
  canonicalAbsolutePath(executable, "Node.js process.execPath");
  canonicalAbsolutePath(expectedExecutable, "Expected Node.js process.execPath");
  if (executable !== expectedExecutable) {
    throw new Error("The staged Node.js executable is not the authoritative process.execPath.");
  }
  const lexical = await lstat(executable);
  if (!lexical.isFile() || lexical.isSymbolicLink()) {
    throw new Error("Node.js process.execPath must be a regular file and not a symbolic link.");
  }
  if ((await realpath(executable)) !== executable) {
    throw new Error("Node.js process.execPath must use its canonical realpath.");
  }
  if (process.platform !== "win32" && (lexical.mode & 0o111) === 0) {
    throw new Error("Node.js process.execPath must be executable.");
  }
}

function admissionPolicy(): RuntimeArtifactAdmissionPolicy {
  const module = require("@workbench/host-artifact-policy/runtime-admission") as {
    readonly RUNTIME_ARTIFACT_ADMISSION_POLICY: RuntimeArtifactAdmissionPolicy;
  };
  return module.RUNTIME_ARTIFACT_ADMISSION_POLICY;
}

async function defaultResolveArtifact({
  manifestPath,
  processIdentity,
}: RuntimeArtifactResolverRequest): Promise<ResolvedRuntimeArtifact> {
  return resolveRuntimeArtifact({
    manifestPath,
    policy: admissionPolicy(),
    processIdentity,
  });
}

async function defaultRunProducer(request: RuntimeArtifactProducerRequest): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      env: request.environment,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Runtime artifact producer terminated by ${signal}.`));
      } else if (code !== 0) {
        reject(new Error(`Runtime artifact producer failed with exit code ${code ?? "unknown"}.`));
      } else {
        resolve();
      }
    });
  });
}

function packageManagerInvocation(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): Pick<RuntimeArtifactProducerRequest, "args" | "command"> {
  const executable = environment.npm_execpath;
  if (!executable) {
    throw new Error("Missing npm_execpath. Run Tauri sidecar staging through pnpm.");
  }
  const extension = path.extname(executable).toLowerCase();
  if (PACKAGE_MANAGER_JAVASCRIPT_EXTENSIONS.has(extension)) {
    return { command: process.execPath, args: [executable, ...args] };
  }
  if (extension === ".bat" || extension === ".cmd") {
    throw new Error(
      `Expected pnpm's executable or JavaScript CLI entry, but npm_execpath points to a Windows batch shim: ${executable}`,
    );
  }
  return { command: executable, args };
}

async function pathKind(value: string): Promise<"absent" | "directory" | "file" | "other"> {
  try {
    const stats = await lstat(value);
    if (stats.isSymbolicLink()) return "other";
    if (stats.isDirectory()) return "directory";
    if (stats.isFile()) return "file";
    return "other";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
    throw error;
  }
}

async function readEnvelope(runtimeDirectory: string): Promise<{
  readonly envelope: TauriSidecarEnvelope;
  readonly serialized: string;
}> {
  const envelopePath = path.join(runtimeDirectory, TAURI_SIDECAR_ENVELOPE_FILENAME);
  await measureOrCopyRegularFile(envelopePath, {
    label: "Published Tauri sidecar envelope",
  });
  const serialized = await readFile(envelopePath, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new Error("Published Tauri sidecar envelope is invalid JSON.", { cause: error });
  }
  const envelope = parseTauriSidecarEnvelope(value);
  if (!envelope || serializeTauriSidecarEnvelope(envelope) !== serialized) {
    throw new Error("Published Tauri sidecar envelope is not canonical.");
  }
  return { envelope, serialized };
}

async function inspectPublishedState(tauriSourceRoot: string): Promise<PublishedState> {
  const binariesDirectory = path.join(tauriSourceRoot, "binaries");
  const runtimeDirectory = path.join(tauriSourceRoot, "resources", "runtime");
  const binariesKind = await pathKind(binariesDirectory);
  const runtimeKind = await pathKind(runtimeDirectory);
  if (runtimeKind === "absent") {
    if (binariesKind === "absent") return { kind: "fresh", snapshot: "absent" };
    if (binariesKind !== "directory") {
      throw new Error("Tauri sidecar binaries path contains unmanaged drift.");
    }
    await canonicalDirectory(binariesDirectory, "Tauri sidecar binaries directory");
    const entries = await readdir(binariesDirectory);
    if (entries.length !== 0) {
      throw new Error("Tauri sidecar binaries exist without a committed Runtime envelope.");
    }
    const stats = await lstat(binariesDirectory);
    return { kind: "fresh", snapshot: `empty:${stats.mode & 0o777}` };
  }
  if (runtimeKind !== "directory" || binariesKind !== "directory") {
    throw new Error("Tauri sidecar publication contains unmanaged drift.");
  }
  await canonicalDirectory(runtimeDirectory, "Published Runtime resource directory");
  await canonicalDirectory(binariesDirectory, "Published Tauri sidecar binaries directory");
  const { envelope } = await readEnvelope(runtimeDirectory);
  const binaryEntries = await readdir(binariesDirectory);
  binaryEntries.sort(compareText);
  if (JSON.stringify(binaryEntries) !== JSON.stringify([envelope.nodeBinary.filename])) {
    throw new Error("Published Tauri sidecar binaries do not match their envelope.");
  }
  const binaryPath = path.join(binariesDirectory, envelope.nodeBinary.filename);
  const binary = await measureOrCopyRegularFile(binaryPath, {
    label: "Published Tauri sidecar binary",
    executable: true,
  });
  if (binary.size !== envelope.nodeBinary.size || binary.sha256 !== envelope.nodeBinary.sha256) {
    throw new Error("Published Tauri sidecar binary drifted from its envelope.");
  }
  const manifest = await measureOrCopyRegularFile(
    path.join(runtimeDirectory, RUNTIME_ARTIFACT_MANIFEST_FILENAME),
    { label: "Published Runtime source manifest" },
  );
  if (
    manifest.size !== envelope.sourceManifest.size ||
    manifest.sha256 !== envelope.sourceManifest.sha256
  ) {
    throw new Error("Published Runtime source manifest drifted from its envelope.");
  }
  const materializedTree = await digestLinkFreeTree(runtimeDirectory, {
    exclude: [TAURI_SIDECAR_ENVELOPE_FILENAME],
  });
  if (!exactDigest(materializedTree, envelope.materializedTree)) {
    throw new Error("Published Runtime resource tree drifted from its envelope.");
  }
  const completeRuntimeTree = await digestLinkFreeTree(runtimeDirectory);
  return {
    kind: "published",
    binaryPath,
    envelope,
    snapshot: JSON.stringify({ completeRuntimeTree, binary }),
  };
}

async function rollbackPublication({
  runtimeDirectory,
  newBinaryPath,
  previousBinaryPath,
  backupRuntime,
  backupBinary,
  movedRuntime,
  movedBinary,
  publishedBinary,
}: {
  readonly runtimeDirectory: string;
  readonly newBinaryPath: string;
  readonly previousBinaryPath?: string;
  readonly backupRuntime: string;
  readonly backupBinary: string;
  readonly movedRuntime: boolean;
  readonly movedBinary: boolean;
  readonly publishedBinary: boolean;
}): Promise<void> {
  const failures: unknown[] = [];
  if (publishedBinary) {
    await rm(newBinaryPath, { force: true }).catch((error) => failures.push(error));
  }
  if (movedBinary && previousBinaryPath) {
    await rename(backupBinary, previousBinaryPath).catch((error) => failures.push(error));
  }
  if (movedRuntime) {
    await rename(backupRuntime, runtimeDirectory).catch((error) => failures.push(error));
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Tauri sidecar publication rollback failed.");
  }
}

export async function stageTauriSidecarEnvelope(
  options: StageTauriSidecarOptions = {},
): Promise<StagedTauriSidecar> {
  const repositoryRoot = canonicalAbsolutePath(
    options.repositoryRoot ?? REPOSITORY_ROOT,
    "Repository root",
  );
  const runtimeArtifactRoot = canonicalAbsolutePath(
    options.runtimeArtifactRoot ?? DEFAULT_RUNTIME_ARTIFACT_ROOT,
    "Runtime artifact output root",
  );
  const tauriSourceRoot = await canonicalDirectory(
    options.tauriSourceRoot ?? DEFAULT_TAURI_SOURCE_ROOT,
    "Tauri source root",
  );
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const expectedProcessExecutable = options.expectedProcessExecutable ?? process.execPath;
  await assertProcessExecutable(nodeExecutable, expectedProcessExecutable);
  const admittedNodeBinary = await measureOrCopyRegularFile(nodeExecutable, {
    label: "Node.js process.execPath",
    executable: true,
  });
  const authoritativeIdentity = options.processIdentity ?? currentRuntimeProcessIdentity();
  const probedIdentity = await (options.probeNodeIdentity ?? probeNodeExecutableIdentity)(
    nodeExecutable,
  );
  const expectedTarget = nodeTargetFromIdentity(authoritativeIdentity);
  const probedTarget = nodeTargetFromIdentity(probedIdentity);
  if (!exactTarget(probedTarget, expectedTarget)) {
    throw new Error("Node.js process.execPath identity does not match the staging process.");
  }

  const environment = options.environment ?? process.env;
  const producerInvocation = packageManagerInvocation(
    ["--filter", "@workbench/runtime-node", "run", "build:artifact"],
    environment,
  );
  await (options.runProducer ?? defaultRunProducer)({
    ...producerInvocation,
    cwd: repositoryRoot,
    environment,
  });

  const manifestPath = path.join(
    runtimeArtifactRoot,
    runtimeArtifactTargetKey(expectedTarget),
    RUNTIME_ARTIFACT_MANIFEST_FILENAME,
  );
  const artifact = await (options.resolveArtifact ?? defaultResolveArtifact)({
    manifestPath,
    processIdentity: probedIdentity,
  });
  assertRuntimeArtifactTargetMatchesProcess(artifact.manifest.target, probedIdentity);
  if (!exactTarget(artifact.manifest.target, expectedTarget)) {
    throw new Error("Runtime artifact target does not exactly match process.execPath.");
  }
  if (
    artifact.manifestPath !== manifestPath ||
    artifact.artifactRoot !== path.dirname(manifestPath)
  ) {
    throw new Error("Runtime artifact resolver returned an unexpected artifact root.");
  }

  const sourceManifest = await measureOrCopyRegularFile(artifact.manifestPath, {
    label: "Admitted Runtime artifact manifest",
    confinedRoot: artifact.artifactRoot,
  });
  const existing = await inspectPublishedState(tauriSourceRoot);
  const binaryFilename = tauriExternalBinaryFilename(expectedTarget);
  const binariesDirectory = path.join(tauriSourceRoot, "binaries");
  const resourcesParent = path.join(tauriSourceRoot, "resources");
  const runtimeDirectory = path.join(resourcesParent, "runtime");
  const stageRoot = path.join(tauriSourceRoot, `.sidecar-envelope-${process.pid}-${randomUUID()}`);
  const stagedBinaryDirectory = path.join(stageRoot, "binaries");
  const stagedResourcesParent = path.join(stageRoot, "resources");
  const stagedBinaryPath = path.join(stagedBinaryDirectory, binaryFilename);
  const stagedRuntimeDirectory = path.join(stagedResourcesParent, "runtime");
  const stagedEnvelopePath = path.join(stagedRuntimeDirectory, TAURI_SIDECAR_ENVELOPE_FILENAME);
  const backupRuntime = path.join(stageRoot, "backup-runtime");
  const backupBinary = path.join(stageRoot, "backup-binary");

  await mkdir(stageRoot);
  try {
    await mkdir(stagedBinaryDirectory);
    await mkdir(stagedResourcesParent);
    const nodeBinary = await measureOrCopyRegularFile(nodeExecutable, {
      destination: stagedBinaryPath,
      label: "Node.js process.execPath",
      executable: true,
    });
    if (JSON.stringify(nodeBinary) !== JSON.stringify(admittedNodeBinary)) {
      throw new Error("Node.js process.execPath drifted after its identity was admitted.");
    }
    const verifiedNodeBinary = await measureOrCopyRegularFile(stagedBinaryPath, {
      label: "Staged Tauri sidecar binary",
      executable: true,
    });
    if (JSON.stringify(verifiedNodeBinary) !== JSON.stringify(nodeBinary)) {
      throw new Error("Staged Tauri sidecar binary does not match process.execPath.");
    }
    const materializedTree = await materializeLinkFreeTree(
      artifact.artifactRoot,
      stagedRuntimeDirectory,
    );
    const stagedManifest = await measureOrCopyRegularFile(
      path.join(stagedRuntimeDirectory, RUNTIME_ARTIFACT_MANIFEST_FILENAME),
      { label: "Materialized Runtime source manifest" },
    );
    if (
      stagedManifest.size !== sourceManifest.size ||
      stagedManifest.sha256 !== sourceManifest.sha256
    ) {
      throw new Error("Runtime source manifest drifted during materialization.");
    }
    const verifiedTree = await digestLinkFreeTree(stagedRuntimeDirectory);
    if (!exactDigest(verifiedTree, materializedTree)) {
      throw new Error("Materialized Runtime resource tree drifted before publication.");
    }
    const envelope = Object.freeze({
      schemaVersion: TAURI_SIDECAR_ENVELOPE_SCHEMA_VERSION,
      kind: TAURI_SIDECAR_ENVELOPE_KIND,
      target: expectedTarget,
      nodeBinary: Object.freeze({
        filename: binaryFilename,
        size: nodeBinary.size,
        sha256: nodeBinary.sha256,
      }),
      sourceManifest: Object.freeze({
        filename: RUNTIME_ARTIFACT_MANIFEST_FILENAME,
        size: sourceManifest.size,
        sha256: sourceManifest.sha256,
      }),
      materializedTree,
    }) satisfies TauriSidecarEnvelope;
    await writeFile(stagedEnvelopePath, serializeTauriSidecarEnvelope(envelope), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o644,
    });
    await chmod(stagedEnvelopePath, 0o644);
    await readEnvelope(stagedRuntimeDirectory);
    const stagedTreeAfterEnvelope = await digestLinkFreeTree(stagedRuntimeDirectory, {
      exclude: [TAURI_SIDECAR_ENVELOPE_FILENAME],
    });
    if (!exactDigest(stagedTreeAfterEnvelope, materializedTree)) {
      throw new Error("Tauri sidecar envelope changed the measured Runtime tree.");
    }

    await options.beforePublish?.();
    const current = await inspectPublishedState(tauriSourceRoot);
    if (current.kind !== existing.kind || current.snapshot !== existing.snapshot) {
      throw new Error("Tauri sidecar publication drifted while the replacement was staged.");
    }

    await mkdir(binariesDirectory, { recursive: true });
    await mkdir(resourcesParent, { recursive: true });
    const newBinaryPath = path.join(binariesDirectory, binaryFilename);
    let movedRuntime = false;
    let movedBinary = false;
    let publishedBinary = false;
    try {
      if (existing.kind === "published") {
        await options.beforePublishStep?.("backup-runtime");
        await rename(runtimeDirectory, backupRuntime);
        movedRuntime = true;
        await options.beforePublishStep?.("backup-binary");
        await rename(existing.binaryPath, backupBinary);
        movedBinary = true;
      }
      await options.beforePublishStep?.("publish-binary");
      await rename(stagedBinaryPath, newBinaryPath);
      publishedBinary = true;
      await options.beforePublishStep?.("commit-runtime");
      // This final rename is the sole commit point: the envelope never names a partial binary.
      await rename(stagedRuntimeDirectory, runtimeDirectory);
    } catch (error) {
      try {
        await rollbackPublication({
          runtimeDirectory,
          newBinaryPath,
          previousBinaryPath: existing.kind === "published" ? existing.binaryPath : undefined,
          backupRuntime,
          backupBinary,
          movedRuntime,
          movedBinary,
          publishedBinary,
        });
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Tauri sidecar publication and rollback both failed.",
        );
      }
      throw error;
    }
    await rm(stageRoot, { recursive: true, force: true }).catch(() => undefined);
    return Object.freeze({
      binaryPath: newBinaryPath,
      runtimeDirectory,
      envelopePath: path.join(runtimeDirectory, TAURI_SIDECAR_ENVELOPE_FILENAME),
      envelope,
    });
  } catch (error) {
    await rm(stageRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
