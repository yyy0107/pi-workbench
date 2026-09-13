import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink, realpath, stat } from "node:fs/promises";
import path from "node:path";

import {
  RUNTIME_ARTIFACT_MANIFEST_FILENAME,
  RUNTIME_NODE_ARTIFACT_DYNAMIC_PACKAGES,
  RUNTIME_NODE_ARTIFACT_EXTERNAL_PACKAGES,
  RUNTIME_NODE_ARTIFACT_NATIVE_PACKAGES,
  assertRuntimeArtifactManifest,
  assertRuntimeArtifactNativeInventory,
  isRuntimeArtifactNativePath,
  isRuntimeArtifactResourcePath,
  runtimeArtifactTargetKey,
  type RuntimeArtifactManifest,
  type RuntimeArtifactTarget,
} from "@workbench/host-contracts/runtime-artifact-manifest";

export { runtimeArtifactTargetKey };

export const RUNTIME_ARTIFACT_MANIFEST_MAX_BYTES = 16 * 1024 * 1024;

export interface RuntimeArtifactNativeFilePolicy {
  readonly packageName: string;
  readonly relativePath: string;
  readonly executable?: boolean;
}

export interface RuntimeArtifactModelResourceClosure {
  readonly resources: readonly string[];
  readonly resolvedExamplesRoot: string;
}

export interface RuntimeArtifactAdmissionPolicy {
  readonly expectedUpgradePaths: readonly string[];
  readonly expectedNativeRuntimeFiles: (
    target: RuntimeArtifactTarget,
  ) => readonly RuntimeArtifactNativeFilePolicy[];
  readonly collectModelReadableResources: (options: {
    readonly artifactRoot: string;
  }) => RuntimeArtifactModelResourceClosure;
  readonly assertModelReadableResourceClassification: (options: {
    readonly resources: readonly string[];
    readonly modelReadableResources: readonly string[];
    readonly expectedModelReadableResources: readonly string[];
    readonly resolvedExamplesRoot: string;
  }) => void;
}

export function createRuntimeArtifactAdmissionPolicy(
  policy: RuntimeArtifactAdmissionPolicy,
): RuntimeArtifactAdmissionPolicy {
  if (
    !Array.isArray(policy.expectedUpgradePaths) ||
    !policy.expectedUpgradePaths.every((value) => typeof value === "string") ||
    typeof policy.expectedNativeRuntimeFiles !== "function" ||
    typeof policy.collectModelReadableResources !== "function" ||
    typeof policy.assertModelReadableResourceClassification !== "function"
  ) {
    throw new Error("Runtime artifact admission policy is invalid.");
  }
  return Object.freeze({
    expectedUpgradePaths: Object.freeze([...policy.expectedUpgradePaths]),
    expectedNativeRuntimeFiles: policy.expectedNativeRuntimeFiles,
    collectModelReadableResources: policy.collectModelReadableResources,
    assertModelReadableResourceClassification: policy.assertModelReadableResourceClassification,
  });
}

export interface RuntimeProcessIdentity {
  readonly runtimeFlavor: "node" | "electron-node";
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly libc: RuntimeArtifactTarget["libc"];
  readonly nodeVersion: string;
  readonly nodeModuleAbi: number;
  readonly napiVersion: number;
  readonly electronVersion?: string;
}

function currentLibc(): RuntimeArtifactTarget["libc"] {
  if (process.platform !== "linux") return "none";
  const report = process.report?.getReport?.() as
    | { readonly header?: { readonly glibcVersionRuntime?: string } }
    | undefined;
  return report?.header?.glibcVersionRuntime ? "glibc" : "musl";
}

export function currentRuntimeProcessIdentity(): RuntimeProcessIdentity {
  return Object.freeze({
    runtimeFlavor: process.versions.electron ? "electron-node" : "node",
    platform: process.platform,
    arch: process.arch,
    libc: currentLibc(),
    nodeVersion: process.versions.node,
    nodeModuleAbi: Number(process.versions.modules),
    napiVersion: Number(process.versions.napi),
    ...(process.versions.electron ? { electronVersion: process.versions.electron } : {}),
  });
}

export function assertRuntimeArtifactTargetMatchesProcess(
  target: RuntimeArtifactTarget,
  identity: RuntimeProcessIdentity = currentRuntimeProcessIdentity(),
): void {
  const mismatches = [
    ["runtime flavor", target.runtimeFlavor, identity.runtimeFlavor],
    ["platform", target.platform, identity.platform],
    ["architecture", target.arch, identity.arch],
    ["libc", target.libc, identity.libc],
    ["Node version", target.nodeVersion, identity.nodeVersion],
    ["Node module ABI", target.nodeModuleAbi, identity.nodeModuleAbi],
    ["N-API version", target.napiVersion, identity.napiVersion],
    [
      "Electron version",
      target.runtimeFlavor === "electron-node" ? target.electronVersion : undefined,
      identity.runtimeFlavor === "electron-node" ? identity.electronVersion : undefined,
    ],
  ].filter(([, expected, actual]) => expected !== actual);
  if (mismatches.length > 0) {
    throw new Error(
      `Runtime artifact target does not match its executable (${mismatches.map(([label]) => label).join(", ")}).`,
    );
  }
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function canonicalRequestedPath(requestedPath: string, label: string): string {
  if (
    typeof requestedPath !== "string" ||
    !path.isAbsolute(requestedPath) ||
    path.normalize(requestedPath) !== requestedPath ||
    path.resolve(requestedPath) !== requestedPath
  ) {
    throw new Error(`${label} must be an absolute canonical path without aliases.`);
  }
  return requestedPath;
}

function lexicalArtifactPath(artifactRoot: string, relativePath: string, label: string): string {
  const candidate = path.resolve(artifactRoot, ...relativePath.split("/"));
  if (!isInside(artifactRoot, candidate)) throw new Error(`${label} escapes the Runtime artifact.`);
  return candidate;
}

async function confinedArtifactPath(
  artifactRoot: string,
  relativePath: string,
  label: string,
): Promise<string> {
  const candidate = lexicalArtifactPath(artifactRoot, relativePath, label);
  const resolved = await realpath(candidate);
  if (!isInside(artifactRoot, resolved)) {
    throw new Error(`${label} realpath escapes the Runtime artifact.`);
  }
  return resolved;
}

async function requireRegularArtifactFile(
  artifactRoot: string,
  relativePath: string,
  label: string,
): Promise<string> {
  const candidate = lexicalArtifactPath(artifactRoot, relativePath, label);
  const lexicalStats = await lstat(candidate);
  if (!lexicalStats.isFile() || lexicalStats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file and not a symbolic link.`);
  }
  const resolved = await realpath(candidate);
  if (!isInside(artifactRoot, resolved)) {
    throw new Error(`${label} realpath escapes the Runtime artifact.`);
  }
  if (!(await stat(resolved)).isFile()) throw new Error(`${label} is not a regular file.`);
  return resolved;
}

async function actualArtifactTree(artifactRoot: string): Promise<{
  readonly files: readonly string[];
  readonly links: readonly { readonly path: string; readonly target: string }[];
}> {
  const files: string[] = [];
  const links: { path: string; target: string }[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(artifactRoot, absolute).split(path.sep).join("/");
      if (entry.isSymbolicLink()) {
        links.push({
          path: relative,
          target: (await readlink(absolute)).split(path.sep).join("/"),
        });
        const resolved = await realpath(absolute);
        if (!isInside(artifactRoot, resolved)) {
          throw new Error(`Runtime artifact symlink ${relative} escapes the artifact.`);
        }
        if (isRuntimeArtifactNativePath(relative)) {
          throw new Error(`Runtime native file ${relative} must not be a symbolic link.`);
        }
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        files.push(relative);
      } else {
        throw new Error(`Runtime artifact contains unsupported entry ${relative}.`);
      }
    }
  };
  await walk(artifactRoot);
  files.sort();
  links.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return Object.freeze({
    files: Object.freeze(files),
    links: Object.freeze(links.map((link) => Object.freeze(link))),
  });
}

function assertExactPackageContract(
  actual: readonly string[],
  expected: readonly string[],
  label: string,
): void {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${label} does not match the Runtime artifact contract.`);
  }
}

function packageEntrypoint(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const selected = packageEntrypoint(candidate);
      if (selected) return selected;
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.hasOwn(record, ".")) return packageEntrypoint(record["."]);
  for (const condition of ["import", "node", "default", "require"] as const) {
    if (!Object.hasOwn(record, condition)) continue;
    const selected = packageEntrypoint(record[condition]);
    if (selected) return selected;
  }
  return undefined;
}

async function validateArtifactPackageRoot(
  artifactRoot: string,
  packageName: string,
): Promise<string> {
  const relativeRoot = `node_modules/${packageName}`;
  const packageRoot = await confinedArtifactPath(
    artifactRoot,
    relativeRoot,
    `Runtime artifact package ${packageName}`,
  );
  if (!(await stat(packageRoot)).isDirectory()) {
    throw new Error(`Runtime artifact package ${packageName} is not a directory.`);
  }
  const packageManifest = await requireRegularArtifactFile(
    artifactRoot,
    `${relativeRoot}/package.json`,
    `Runtime artifact package manifest ${packageName}`,
  );
  let packageData: { readonly name?: unknown; readonly exports?: unknown; readonly main?: unknown };
  try {
    packageData = JSON.parse(await readFile(packageManifest, "utf8")) as typeof packageData;
  } catch {
    throw new Error(`Runtime artifact package manifest ${packageName} is invalid.`);
  }
  if (packageData.name !== packageName) {
    throw new Error(`Runtime artifact package manifest ${packageName} has the wrong owner.`);
  }
  const entrypoint =
    packageEntrypoint(packageData.exports) ??
    (typeof packageData.main === "string" ? packageData.main : "index.js");
  if (
    entrypoint.includes("\\") ||
    path.posix.isAbsolute(entrypoint) ||
    entrypoint.startsWith("#")
  ) {
    throw new Error(`Runtime artifact package ${packageName} has an invalid entrypoint.`);
  }
  const normalizedEntrypoint = entrypoint.startsWith("./") ? entrypoint.slice(2) : entrypoint;
  if (
    !normalizedEntrypoint ||
    normalizedEntrypoint
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`Runtime artifact package ${packageName} has an invalid entrypoint.`);
  }
  const entrypointCandidates = [
    normalizedEntrypoint,
    `${normalizedEntrypoint}.js`,
    `${normalizedEntrypoint}.cjs`,
    `${normalizedEntrypoint}.mjs`,
    `${normalizedEntrypoint}.json`,
    `${normalizedEntrypoint}.node`,
    `${normalizedEntrypoint}/index.js`,
    `${normalizedEntrypoint}/index.cjs`,
    `${normalizedEntrypoint}/index.mjs`,
  ];
  for (const candidate of entrypointCandidates) {
    try {
      await requireRegularArtifactFile(
        artifactRoot,
        `${relativeRoot}/${candidate}`,
        `Runtime artifact package entrypoint ${packageName}`,
      );
      return packageRoot;
    } catch {
      // Node package mains may omit an extension or name a directory. Try the exact finite set.
    }
  }
  throw new Error(`Runtime artifact package ${packageName} has no confined entrypoint.`);
}

function nativePackageForPath(relativePath: string): string | undefined {
  const segments = relativePath.split("/");
  const nodeModulesIndex = segments.lastIndexOf("node_modules");
  const first = segments[nodeModulesIndex + 1];
  if (nodeModulesIndex < 0 || !first) return undefined;
  if (!first.startsWith("@")) return first;
  const second = segments[nodeModulesIndex + 2];
  return second ? `${first}/${second}` : undefined;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface ResolveRuntimeArtifactOptions {
  readonly manifestPath: string;
  readonly policy: RuntimeArtifactAdmissionPolicy;
  readonly processIdentity?: RuntimeProcessIdentity;
  readonly expectedTarget?: RuntimeArtifactTarget;
}

export interface ResolvedRuntimeArtifact {
  readonly artifactRoot: string;
  readonly manifestPath: string;
  readonly entrypoint: string;
  readonly manifest: RuntimeArtifactManifest;
}

/** Validates target/runtime ownership and the complete artifact closure before a child may spawn. */
export async function resolveRuntimeArtifact({
  manifestPath,
  policy,
  processIdentity,
  expectedTarget,
}: ResolveRuntimeArtifactOptions): Promise<ResolvedRuntimeArtifact> {
  if (
    typeof policy !== "object" ||
    policy === null ||
    !Object.isFrozen(policy) ||
    !Array.isArray(policy.expectedUpgradePaths) ||
    !Object.isFrozen(policy.expectedUpgradePaths) ||
    typeof policy.expectedNativeRuntimeFiles !== "function" ||
    typeof policy.collectModelReadableResources !== "function" ||
    typeof policy.assertModelReadableResourceClassification !== "function"
  ) {
    throw new Error("Runtime artifact admission policy must be frozen.");
  }
  if (processIdentity && expectedTarget) {
    throw new Error("Runtime artifact resolution accepts one target authority.");
  }
  const requestedManifest = canonicalRequestedPath(manifestPath, "Runtime artifact manifest path");
  if (path.basename(requestedManifest) !== RUNTIME_ARTIFACT_MANIFEST_FILENAME) {
    throw new Error("Runtime artifact manifest has an unexpected filename.");
  }
  const requestedRoot = path.dirname(requestedManifest);
  const rootStats = await lstat(requestedRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("Runtime artifact root must be a regular directory.");
  }
  const artifactRoot = await realpath(requestedRoot);
  if (artifactRoot !== requestedRoot) {
    throw new Error("Runtime artifact root must be canonical.");
  }
  const manifestStats = await lstat(requestedManifest);
  if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) {
    throw new Error("Runtime artifact manifest must be a regular file.");
  }
  if (manifestStats.size <= 0 || manifestStats.size > RUNTIME_ARTIFACT_MANIFEST_MAX_BYTES) {
    throw new Error("Runtime artifact manifest has an invalid size.");
  }
  const resolvedManifest = await realpath(requestedManifest);
  if (resolvedManifest !== requestedManifest || !isInside(artifactRoot, resolvedManifest)) {
    throw new Error("Runtime artifact manifest must be canonical and confined.");
  }
  const manifestBytes = await readFile(resolvedManifest);
  if (
    manifestBytes.byteLength <= 0 ||
    manifestBytes.byteLength > RUNTIME_ARTIFACT_MANIFEST_MAX_BYTES
  ) {
    throw new Error("Runtime artifact manifest has an invalid size.");
  }
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(manifestBytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("Runtime artifact manifest is invalid JSON.");
  }
  const manifest = assertRuntimeArtifactManifest(manifestValue);
  if (
    JSON.stringify(manifest.upgradeRequiredPaths) !== JSON.stringify(policy.expectedUpgradePaths)
  ) {
    throw new Error("Runtime artifact Upgrade path contract does not match the supervisor.");
  }
  if (expectedTarget) {
    if (JSON.stringify(manifest.target) !== JSON.stringify(expectedTarget)) {
      throw new Error("Runtime artifact target does not match the expected target.");
    }
  } else {
    assertRuntimeArtifactTargetMatchesProcess(manifest.target, processIdentity);
  }
  assertExactPackageContract(
    manifest.externalPackages,
    RUNTIME_NODE_ARTIFACT_EXTERNAL_PACKAGES,
    "Runtime external package set",
  );
  const packageRoots = new Map<string, string>();
  for (const packageName of new Set([...manifest.externalPackages, ...manifest.dynamicPackages])) {
    packageRoots.set(packageName, await validateArtifactPackageRoot(artifactRoot, packageName));
  }
  assertExactPackageContract(
    manifest.dynamicPackages,
    RUNTIME_NODE_ARTIFACT_DYNAMIC_PACKAGES,
    "Runtime dynamic package set",
  );
  assertExactPackageContract(
    manifest.nativePackages,
    RUNTIME_NODE_ARTIFACT_NATIVE_PACKAGES,
    "Runtime native package set",
  );
  const entrypoint = await requireRegularArtifactFile(
    artifactRoot,
    manifest.entrypoint,
    "Runtime entrypoint",
  );
  const inventoryPath = await requireRegularArtifactFile(
    artifactRoot,
    manifest.nativeInventory.path,
    "Runtime native inventory",
  );
  const inventoryBytes = await readFile(inventoryPath);
  const inventoryStats = await stat(inventoryPath);
  if (
    inventoryStats.size !== manifest.nativeInventory.size ||
    sha256(inventoryBytes) !== manifest.nativeInventory.sha256
  ) {
    throw new Error("Runtime native inventory does not match the artifact manifest.");
  }
  const inventory = assertRuntimeArtifactNativeInventory(
    JSON.parse(inventoryBytes.toString("utf8")) as unknown,
  );
  if (JSON.stringify(inventory.target) !== JSON.stringify(manifest.target)) {
    throw new Error("Runtime native inventory target does not match the artifact manifest.");
  }
  const actualTree = await actualArtifactTree(artifactRoot);
  if (JSON.stringify(actualTree.links) !== JSON.stringify(manifest.links)) {
    throw new Error("Runtime artifact link manifest does not describe the complete payload.");
  }
  const actualFiles = actualTree.files;
  const actualNativePaths = actualFiles.filter(isRuntimeArtifactNativePath);
  const expectedNativeFiles = policy
    .expectedNativeRuntimeFiles(manifest.target)
    .map((file) => {
      const packageRoot = packageRoots.get(file.packageName);
      if (!packageRoot) throw new Error(`Runtime native package ${file.packageName} is missing.`);
      return Object.freeze({
        path: path
          .relative(artifactRoot, path.join(packageRoot, file.relativePath))
          .split(path.sep)
          .join("/"),
        executable: file.executable === true,
      });
    })
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const expectedNativePaths = expectedNativeFiles.map((file) => file.path);
  if (JSON.stringify(actualNativePaths) !== JSON.stringify(expectedNativePaths)) {
    throw new Error("Runtime artifact native payload does not match its target policy.");
  }
  const declaredNativePaths = inventory.files.map((file) => file.path);
  if (JSON.stringify(actualNativePaths) !== JSON.stringify(declaredNativePaths)) {
    throw new Error("Runtime native inventory does not describe the complete artifact payload.");
  }
  for (const file of inventory.files) {
    const absolute = await requireRegularArtifactFile(
      artifactRoot,
      file.path,
      `Runtime native file ${file.path}`,
    );
    const fileStats = await lstat(absolute);
    const bytes = await readFile(absolute);
    if (
      fileStats.size !== file.size ||
      (fileStats.mode & 0o777) !== file.mode ||
      sha256(bytes) !== file.sha256
    ) {
      throw new Error(`Runtime native file ${file.path} does not match its inventory.`);
    }
    if (
      expectedNativeFiles.find((expected) => expected.path === file.path)?.executable &&
      (fileStats.mode & 0o111) === 0
    ) {
      throw new Error(`Runtime native helper ${file.path} must be executable.`);
    }
  }
  const actualNativePackages = [
    ...new Set(
      declaredNativePaths
        .map(nativePackageForPath)
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort();
  if (declaredNativePaths.some((file) => nativePackageForPath(file) === undefined)) {
    throw new Error("Runtime native inventory contains a file without a package owner.");
  }
  if (
    JSON.stringify(actualNativePackages) !== JSON.stringify([...manifest.nativePackages].sort())
  ) {
    throw new Error("Runtime native package declaration does not match its inventory.");
  }
  const actualResources = actualFiles.filter((file) =>
    isRuntimeArtifactResourcePath(file, {
      entrypoint: manifest.entrypoint,
      nativeInventoryPath: manifest.nativeInventory.path,
    }),
  );
  if (JSON.stringify(actualResources) !== JSON.stringify(manifest.resources)) {
    throw new Error("Runtime artifact resource manifest does not describe the complete payload.");
  }
  // The schema establishes only a subset relation. Admission additionally binds that subset to
  // the final physical Pi README/docs/examples closure, and permits TS/test bytes nowhere else.
  const modelClosure = policy.collectModelReadableResources({
    artifactRoot,
  });
  const classifiedResources = [
    ...actualResources,
    ...actualTree.links.map((link) => link.path),
  ].sort();
  policy.assertModelReadableResourceClassification({
    resources: classifiedResources,
    modelReadableResources: manifest.modelReadableResources,
    expectedModelReadableResources: modelClosure.resources,
    resolvedExamplesRoot: modelClosure.resolvedExamplesRoot,
  });

  return Object.freeze({ artifactRoot, manifestPath: resolvedManifest, entrypoint, manifest });
}
