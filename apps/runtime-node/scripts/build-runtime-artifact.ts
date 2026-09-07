import {
  isInside,
  canonicalPathSpelling,
  directoryIdentity,
  optionalDirectoryIdentity,
  sameDirectoryIdentity,
  type DirectoryIdentity,
} from "@workbench/host-artifact-policy/filesystem";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  cp,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createRequire, isBuiltin } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build, type BuildOptions, type BuildResult, type Metafile } from "esbuild";

import { STREAM_PATHS } from "@workbench/agent-runtime-pi-protocol/stream";
import {
  RUNTIME_ARTIFACT_MANIFEST_FILENAME as CONTRACT_RUNTIME_ARTIFACT_MANIFEST_FILENAME,
  RUNTIME_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  RUNTIME_NODE_ARTIFACT_DYNAMIC_PACKAGES,
  RUNTIME_NODE_ARTIFACT_EXTERNAL_PACKAGES,
  RUNTIME_NODE_ARTIFACT_NATIVE_PACKAGES,
  assertRuntimeArtifactManifest,
  assertRuntimeArtifactNativeInventory,
  isRuntimeArtifactResourcePath,
  runtimeArtifactTargetKey as contractRuntimeArtifactTargetKey,
  type RuntimeArtifactNativeInventory,
  type RuntimeArtifactManifest,
  type RuntimeArtifactTarget,
} from "@workbench/host-contracts/runtime-artifact-manifest";
import {
  RUNTIME_HOST_CONTROL_VERSION,
  RUNTIME_HOST_PROTOCOL_VERSION,
} from "@workbench/host-contracts/runtime-host-control";
import {
  createRuntimeArtifactAdmissionPolicy,
  resolveRuntimeArtifact,
  type ResolveRuntimeArtifactOptions,
  type ResolvedRuntimeArtifact,
  type RuntimeArtifactAdmissionPolicy,
} from "@workbench/host-server/runtime-artifact";

/** These are the imports that intentionally remain unresolved in the esbuild output. */
export const RUNTIME_ARTIFACT_EXTERNAL_PACKAGES = RUNTIME_NODE_ARTIFACT_EXTERNAL_PACKAGES;
/** Pi resolves providers and extensions dynamically, so its complete published package is retained. */
export const RUNTIME_ARTIFACT_DYNAMIC_PACKAGES = RUNTIME_NODE_ARTIFACT_DYNAMIC_PACKAGES;
export const RUNTIME_ARTIFACT_NATIVE_PACKAGES = RUNTIME_NODE_ARTIFACT_NATIVE_PACKAGES;
/** Externals whose production dependency owner is the Runtime application itself. */
export const RUNTIME_ARTIFACT_APP_OWNED_EXTERNAL_PACKAGES = Object.freeze(
  RUNTIME_ARTIFACT_EXTERNAL_PACKAGES.filter(
    (packageName) =>
      !RUNTIME_ARTIFACT_NATIVE_PACKAGES.includes(packageName) &&
      !RUNTIME_ARTIFACT_DYNAMIC_PACKAGES.includes(packageName),
  ),
);

export interface RuntimeAppOwnedExternalTraceAlias {
  readonly packageName: string;
  readonly sourceRelativePath: string;
  readonly destinationRelativePath: string;
}

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const RUNTIME_NODE_APP_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
export const REPOSITORY_ROOT = path.resolve(RUNTIME_NODE_APP_ROOT, "../..");
export const DEFAULT_RUNTIME_ARTIFACT_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  ".desktop-build",
  "runtime-node",
);
export const RUNTIME_ARTIFACT_MANIFEST_FILENAME = CONTRACT_RUNTIME_ARTIFACT_MANIFEST_FILENAME;
export const RUNTIME_ARTIFACT_NATIVE_INVENTORY_FILENAME = "native-runtime-inventory.json";
export const RUNTIME_ARTIFACT_ENTRYPOINT = "server.mjs";

const NFT_DYNAMIC_SEGMENT = "\x1a";
const TREE_SITTER_DYNAMIC_PREBUILD_DEPENDENCY = `./prebuilds/${NFT_DYNAMIC_SEGMENT}-${NFT_DYNAMIC_SEGMENT}/tree-sitter.node`;
const runtimeAppRequire = createRequire(import.meta.url);
const nativeTools = runtimeAppRequire("@workbench/host-artifact-policy/runtime-native") as {
  readonly NODE_PTY_NATIVE_BUILD_MANIFEST_ENV: string;
  readonly expectedNativeRuntimeFiles: (
    target: Pick<RuntimeArtifactTarget, "platform" | "arch">,
  ) => readonly {
    readonly packageName: string;
    readonly relativePath: string;
    readonly executable: boolean;
  }[];
  readonly prunePackageNativeVariants: (
    directory: string,
    packageName: string,
    target: RuntimeArtifactTarget,
    options?: {
      readonly nativeBuildManifestPath?: string;
      readonly repositoryRoot?: string;
    },
  ) => void;
  readonly collectNativeRuntimeInventory: (directory: string) => readonly {
    readonly path: string;
    readonly size: number;
    readonly sha256: string;
    readonly mode: number;
  }[];
  readonly nativeMaterializationMutationPolicy: (
    target: RuntimeArtifactTarget,
  ) => readonly { readonly packageName: string; readonly relativeRoot: string }[];
};
const admissionPolicyTools = runtimeAppRequire(
  "@workbench/host-artifact-policy/runtime-admission",
) as {
  readonly createRuntimeArtifactAdmissionPolicy: (agentRuntimeUpgradePaths: readonly string[]) => {
    readonly expectedUpgradePaths: readonly string[];
    readonly expectedNativeRuntimeFiles: (target: RuntimeArtifactTarget) => readonly {
      readonly packageName: string;
      readonly relativePath: string;
      readonly executable?: boolean;
    }[];
    readonly collectModelReadableResources: (options: { readonly artifactRoot: string }) => {
      readonly resources: readonly string[];
      readonly resolvedExamplesRoot: string;
    };
    readonly assertModelReadableResourceClassification: (options: {
      readonly resources: readonly string[];
      readonly modelReadableResources: readonly string[];
      readonly expectedModelReadableResources: readonly string[];
      readonly resolvedExamplesRoot: string;
    }) => void;
  };
};
const runtimeArtifactAdmissionPolicy = createRuntimeArtifactAdmissionPolicy(
  admissionPolicyTools.createRuntimeArtifactAdmissionPolicy([STREAM_PATHS.mux, STREAM_PATHS.host]),
);
/** The exact app/terminal upgrade contract comes from the shared injected admission policy. */
export const RUNTIME_ARTIFACT_UPGRADE_PATHS = runtimeArtifactAdmissionPolicy.expectedUpgradePaths;
const modelResourceTools = runtimeAppRequire(
  "@workbench/host-artifact-policy/runtime-model-resources",
) as {
  readonly collectRuntimeArtifactModelReadableResources: (options: {
    readonly artifactRoot: string;
  }) => {
    readonly resources: readonly string[];
    readonly resolvedExamplesRoot: string;
  };
  readonly assertRuntimeArtifactModelReadableResourceClassification: (options: {
    readonly resources: readonly string[];
    readonly modelReadableResources: readonly string[];
    readonly expectedModelReadableResources: readonly string[];
    readonly resolvedExamplesRoot: string;
  }) => void;
  readonly isRuntimeArtifactModelReadableException: (
    relativePath: string,
    modelReadableResources: readonly string[],
    resolvedExamplesRoot: string,
  ) => boolean;
  readonly isTypeScriptOrTestPath: (relativePath: string) => boolean;
};

type NodeFileTrace = (
  entries: readonly string[],
  options: Record<string, unknown>,
) => Promise<{
  readonly fileList: Set<string>;
  readonly warnings: Set<Error>;
}>;

type NodeFileTraceResolution = string | string[];
type NodeFileTraceResolver = (
  specifier: string,
  parent: string,
  job: unknown,
  cjsResolve: boolean,
) => Promise<NodeFileTraceResolution>;

export interface RuntimeArtifactTargetAdapter {
  /** A target may only be materialized by an adapter for that runtime ABI. */
  readonly runtimeFlavor: RuntimeArtifactTarget["runtimeFlavor"];
  validateTarget(target: RuntimeArtifactTarget): void | Promise<void>;
  /** Rebuild or otherwise materialize ABI-specific bytes after the JS closure is copied. */
  materialize?(context: RuntimeArtifactMaterializationContext): void | Promise<void>;
}

export interface RuntimeArtifactMaterializationContext {
  readonly target: RuntimeArtifactTarget;
  readonly outputDirectory: string;
  readonly repositoryRoot: string;
}

export interface RuntimeArtifactMaterializerCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export interface RuntimeArtifactBuildRequest {
  readonly schemaVersion: 1;
  readonly target: RuntimeArtifactTarget;
  readonly outputDirectory: string;
  readonly materializer: RuntimeArtifactMaterializerCommand;
}

export interface RuntimeArtifactMaterializationRequest {
  readonly schemaVersion: 1;
  readonly target: RuntimeArtifactTarget;
  readonly outputDirectory: string;
  readonly repositoryRoot: string;
}

export const RUNTIME_ARTIFACT_BUILD_REQUEST_FLAG = "--request-json";
export const RUNTIME_ARTIFACT_MATERIALIZATION_REQUEST_FLAG = "--request-json";

export type RuntimeArtifactMaterializationSnapshot = ReadonlyMap<string, string>;

export async function runtimeArtifactMaterializationSnapshot(
  artifactRoot: string,
): Promise<RuntimeArtifactMaterializationSnapshot> {
  const snapshot = new Map<string, string>();
  const regularFileLinks = new Map<
    string,
    { readonly linkCount: bigint; readonly paths: string[] }
  >();
  // Windows file IDs exceed Number's safe integer range. BigInt stats prevent two unrelated files
  // from collapsing to the same dev/ino key during the native materialization boundary scan.
  const rootStats = await lstat(artifactRoot, { bigint: true });
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("Runtime artifact materialization root must be a real directory.");
  }
  snapshot.set(
    ".",
    `directory:${rootStats.mode & BigInt(0o7777)}:${rootStats.dev}:${rootStats.ino}:${rootStats.nlink}`,
  );
  async function visit(directory: string, relativeDirectory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.posix.join(relativeDirectory, entry.name);
      const stats = await lstat(absolute, { bigint: true });
      const mode = stats.mode & BigInt(0o7777);
      if (stats.isSymbolicLink()) {
        snapshot.set(
          relative,
          `link:${mode}:${stats.dev}:${stats.ino}:${stats.nlink}:${await readlink(absolute)}`,
        );
      } else if (stats.isDirectory()) {
        snapshot.set(relative, `directory:${mode}:${stats.dev}:${stats.ino}:${stats.nlink}`);
        await visit(absolute, relative);
      } else if (stats.isFile()) {
        const identity = `${stats.dev}:${stats.ino}`;
        const existing = regularFileLinks.get(identity);
        if (existing) {
          if (existing.linkCount !== stats.nlink) {
            throw new Error(
              `Runtime artifact regular file identity ${identity} changed while scanning.`,
            );
          }
          existing.paths.push(relative);
        } else {
          regularFileLinks.set(identity, { linkCount: stats.nlink, paths: [relative] });
        }
        const contents = await readFile(absolute);
        snapshot.set(
          relative,
          `file:${mode}:${stats.dev}:${stats.ino}:${stats.nlink}:${stats.size}:${createHash("sha256").update(contents).digest("hex")}`,
        );
      } else {
        snapshot.set(
          relative,
          `other:${mode}:${stats.dev}:${stats.ino}:${stats.nlink}:${stats.size}`,
        );
      }
    }
  }
  await visit(artifactRoot, "");
  for (const { linkCount, paths } of regularFileLinks.values()) {
    if (BigInt(paths.length) !== linkCount) {
      throw new Error(
        `Runtime artifact regular file ${paths[0]} has ${linkCount} hard links but only ${paths.length} ${paths.length === 1 ? "name" : "names"} inside the artifact.`,
      );
    }
  }
  return snapshot;
}

export function assertRuntimeArtifactMaterializationMutationBoundary(
  before: RuntimeArtifactMaterializationSnapshot,
  after: RuntimeArtifactMaterializationSnapshot,
  allowedRoots: readonly string[],
): void {
  const changed = [...new Set([...before.keys(), ...after.keys()])]
    .filter((relativePath) => before.get(relativePath) !== after.get(relativePath))
    .filter(
      (relativePath) =>
        !allowedRoots.some((root) => relativePath === root || relativePath.startsWith(`${root}/`)),
    )
    .sort();
  if (changed.length > 0) {
    throw new Error(
      `Runtime artifact target materializer changed paths outside declared native owner subtrees: ${changed.join(", ")}.`,
    );
  }
}

export interface RuntimeArtifactMaterializationMutationRoot {
  readonly packageAlias: string;
  readonly packageDevice: number;
  readonly packageDirectory: string;
  readonly packageInode: number;
  readonly relativePath: string;
  readonly relativeRoot: string;
}

export async function runtimeArtifactMaterializationMutationRoots(
  artifactRoot: string,
  target: RuntimeArtifactTarget,
): Promise<readonly RuntimeArtifactMaterializationMutationRoot[]> {
  const roots = [];
  for (const owner of nativeTools.nativeMaterializationMutationPolicy(target)) {
    const packageAlias = path.join(artifactRoot, "node_modules", ...owner.packageName.split("/"));
    const packageDirectory = await realpath(packageAlias);
    if (!isInside(artifactRoot, packageDirectory)) {
      throw new Error(
        `Runtime artifact native mutation owner ${owner.packageName} escapes the candidate.`,
      );
    }
    const packageStats = await lstat(packageDirectory);
    if (!packageStats.isDirectory() || packageStats.isSymbolicLink()) {
      throw new Error(`Runtime artifact native mutation owner ${owner.packageName} is not real.`);
    }
    const mutationRootPath = path.join(packageDirectory, owner.relativeRoot);
    const mutationRootStats = await lstat(mutationRootPath);
    if (!mutationRootStats.isDirectory() || mutationRootStats.isSymbolicLink()) {
      throw new Error(
        `Runtime artifact native mutation root ${owner.packageName}/${owner.relativeRoot} must be a real directory.`,
      );
    }
    const mutationRoot = await realpath(mutationRootPath);
    if (!isInside(packageDirectory, mutationRoot) || !isInside(artifactRoot, mutationRoot)) {
      throw new Error(
        `Runtime artifact native mutation root ${owner.packageName}/${owner.relativeRoot} escapes its package owner.`,
      );
    }
    roots.push(
      Object.freeze({
        packageAlias,
        packageDevice: packageStats.dev,
        packageDirectory,
        packageInode: packageStats.ino,
        relativePath: path.relative(artifactRoot, mutationRoot).split(path.sep).join("/"),
        relativeRoot: owner.relativeRoot,
      }),
    );
  }
  return Object.freeze(
    roots.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
  );
}

export async function assertRuntimeArtifactMaterializationRootsUnchanged(
  artifactRoot: string,
  roots: readonly RuntimeArtifactMaterializationMutationRoot[],
): Promise<void> {
  for (const root of roots) {
    const packageDirectory = await realpath(root.packageAlias);
    const packageStats = await lstat(packageDirectory);
    if (
      packageDirectory !== root.packageDirectory ||
      !isInside(artifactRoot, packageDirectory) ||
      !packageStats.isDirectory() ||
      packageStats.isSymbolicLink() ||
      packageStats.dev !== root.packageDevice ||
      packageStats.ino !== root.packageInode
    ) {
      throw new Error(
        "Runtime artifact native mutation package owner changed during materialization.",
      );
    }
    const mutationRootPath = path.join(packageDirectory, root.relativeRoot);
    const mutationRootStats = await lstat(mutationRootPath);
    if (!mutationRootStats.isDirectory() || mutationRootStats.isSymbolicLink()) {
      throw new Error(
        `Runtime artifact native mutation root ${root.relativePath} must remain a real directory.`,
      );
    }
    const physicalRoot = await realpath(mutationRootPath);
    if (!isInside(packageDirectory, physicalRoot) || !isInside(artifactRoot, physicalRoot)) {
      throw new Error(
        `Runtime artifact native mutation root ${root.relativePath} escaped its owner.`,
      );
    }
    const pending = [physicalRoot];
    while (pending.length > 0) {
      const directory = pending.pop();
      if (!directory) continue;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        const entryStats = await lstat(entryPath);
        if (entryStats.isSymbolicLink()) {
          throw new Error(
            `Runtime artifact native mutation root ${root.relativePath} contains a symlink after materialization.`,
          );
        }
        const physicalEntry = await realpath(entryPath);
        if (!isInside(physicalRoot, physicalEntry) || !isInside(artifactRoot, physicalEntry)) {
          throw new Error(
            `Runtime artifact native mutation root ${root.relativePath} contains an escaping entry.`,
          );
        }
        if (entryStats.isDirectory()) pending.push(physicalEntry);
      }
    }
  }
}

function assertExactObjectKeys(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} must contain exactly: ${expected.join(", ")}.`);
  }
}

function runtimeArtifactMaterializerCommand(value: unknown): RuntimeArtifactMaterializerCommand {
  assertExactObjectKeys(value, ["args", "command"], "Runtime artifact materializer command");
  const candidate = value as { readonly command?: unknown; readonly args?: unknown };
  if (typeof candidate.command !== "string" || !path.isAbsolute(candidate.command)) {
    throw new Error("Runtime artifact materializer command must be an absolute executable path.");
  }
  if (!Array.isArray(candidate.args) || candidate.args.some((arg) => typeof arg !== "string")) {
    throw new Error("Runtime artifact materializer arguments must be strings.");
  }
  return Object.freeze({ command: candidate.command, args: Object.freeze([...candidate.args]) });
}

/** Public CLI request parser for target-specific artifact production owned by this app. */
export function parseRuntimeArtifactBuildRequest(
  args: readonly string[],
): RuntimeArtifactBuildRequest | undefined {
  if (args.length === 0) return undefined;
  if (args.length !== 2 || args[0] !== RUNTIME_ARTIFACT_BUILD_REQUEST_FLAG) {
    throw new Error(
      `Usage: build-runtime-artifact.ts [${RUNTIME_ARTIFACT_BUILD_REQUEST_FLAG} <json>]`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(args[1]);
  } catch {
    throw new Error("Runtime artifact build request is invalid JSON.");
  }
  assertExactObjectKeys(
    value,
    ["materializer", "outputDirectory", "schemaVersion", "target"],
    "Runtime artifact build request",
  );
  const candidate = value as {
    readonly schemaVersion?: unknown;
    readonly target?: unknown;
    readonly outputDirectory?: unknown;
    readonly materializer?: unknown;
  };
  if (candidate.schemaVersion !== 1) {
    throw new Error("Runtime artifact build request schema version is unsupported.");
  }
  if (
    typeof candidate.outputDirectory !== "string" ||
    !path.isAbsolute(candidate.outputDirectory)
  ) {
    throw new Error("Runtime artifact build output directory must be absolute.");
  }
  return Object.freeze({
    schemaVersion: 1,
    target: validateTargetWithContract(candidate.target as RuntimeArtifactTarget),
    outputDirectory: path.resolve(candidate.outputDirectory),
    materializer: runtimeArtifactMaterializerCommand(candidate.materializer),
  });
}

export function createCommandRuntimeArtifactTargetAdapter(
  request: RuntimeArtifactBuildRequest,
  {
    environment = process.env,
    spawn = spawnSync,
  }: {
    readonly environment?: NodeJS.ProcessEnv;
    readonly spawn?: typeof spawnSync;
  } = {},
): RuntimeArtifactTargetAdapter {
  return Object.freeze({
    runtimeFlavor: request.target.runtimeFlavor,
    validateTarget(target: RuntimeArtifactTarget) {
      if (JSON.stringify(target) !== JSON.stringify(request.target)) {
        throw new Error("Runtime artifact target does not match the target materializer request.");
      }
    },
    async materialize(context: RuntimeArtifactMaterializationContext) {
      const allowedMutationRoots = await runtimeArtifactMaterializationMutationRoots(
        context.outputDirectory,
        context.target,
      );
      const before = await runtimeArtifactMaterializationSnapshot(context.outputDirectory);
      const materializationRequest: RuntimeArtifactMaterializationRequest = Object.freeze({
        schemaVersion: 1,
        target: context.target,
        outputDirectory: context.outputDirectory,
        repositoryRoot: context.repositoryRoot,
      });
      const result = spawn(
        request.materializer.command,
        [
          ...request.materializer.args,
          RUNTIME_ARTIFACT_MATERIALIZATION_REQUEST_FLAG,
          JSON.stringify(materializationRequest),
        ],
        {
          cwd: context.repositoryRoot,
          env: environment,
          stdio: "inherit",
          windowsHide: true,
        },
      );
      await assertRuntimeArtifactMaterializationRootsUnchanged(
        context.outputDirectory,
        allowedMutationRoots,
      );
      const after = await runtimeArtifactMaterializationSnapshot(context.outputDirectory);
      assertRuntimeArtifactMaterializationMutationBoundary(
        before,
        after,
        allowedMutationRoots.map((root) => root.relativePath),
      );
      if (result.error) throw result.error;
      if (result.status !== 0) {
        throw new Error(
          `Runtime artifact target materializer failed with exit code ${result.status ?? "unknown"}.`,
        );
      }
    },
  });
}

function packageNameForSpecifier(specifier: string): string | undefined {
  if (isBuiltin(specifier)) return undefined;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

export function externalSpecifiersForPackages(packageNames: readonly string[]): string[] {
  return packageNames.flatMap((packageName) => [packageName, `${packageName}/*`]);
}

export function createRuntimeArtifactBuildOptions({
  appRoot = RUNTIME_NODE_APP_ROOT,
  outputDirectory,
}: {
  readonly appRoot?: string;
  readonly outputDirectory: string;
}): BuildOptions {
  return {
    absWorkingDir: appRoot,
    bundle: true,
    entryPoints: ["src/main.ts"],
    external: externalSpecifiersForPackages(RUNTIME_ARTIFACT_EXTERNAL_PACKAGES),
    format: "esm",
    legalComments: "none",
    metafile: true,
    outfile: path.join(outputDirectory, RUNTIME_ARTIFACT_ENTRYPOINT),
    platform: "node",
    sourcemap: false,
    target: "node22",
  };
}

export function externalPackagesFromMetafile(metafile: Metafile): readonly string[] {
  return Object.freeze(
    [
      ...new Set(
        Object.values(metafile.outputs)
          .flatMap((output) => output.imports)
          .filter((item) => item.external)
          .map((item) => packageNameForSpecifier(item.path))
          .filter((item): item is string => item !== undefined),
      ),
    ].sort(),
  );
}

export function assertRuntimeArtifactExternalPackages(
  externalPackages: readonly string[],
): readonly string[] {
  const actual = [...new Set(externalPackages)].sort();
  const workspacePackages = actual.filter((packageName) => packageName.startsWith("@workbench/"));
  if (workspacePackages.length > 0) {
    throw new Error(
      `Runtime artifact must bundle every Workbench package: ${workspacePackages.join(", ")}.`,
    );
  }
  if (actual.includes("next")) throw new Error("Runtime artifact must not depend on Next.js.");
  const expected = [...RUNTIME_ARTIFACT_EXTERNAL_PACKAGES].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Runtime artifact external package set changed: ${actual.join(", ") || "none"}; expected ${expected.join(", ")}.`,
    );
  }
  return Object.freeze(actual);
}

function artifactRelativePath(relativePath: string): string {
  const normalized = relativePath.split(path.sep).join("/");
  if (
    normalized.length === 0 ||
    path.posix.isAbsolute(normalized) ||
    normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe artifact relative path: ${relativePath}.`);
  }
  return normalized;
}

export function assertRuntimeArtifactInputClosure(
  metafile: Metafile,
  {
    appRoot = RUNTIME_NODE_APP_ROOT,
    repositoryRoot = REPOSITORY_ROOT,
  }: { readonly appRoot?: string; readonly repositoryRoot?: string } = {},
): void {
  const packagesRoot = path.join(repositoryRoot, "packages");
  const forbidden: string[] = [];
  for (const input of Object.keys(metafile.inputs)) {
    const absolute = path.resolve(appRoot, input);
    const normalized = input.split(path.sep).join("/");
    if (normalized.includes("/node_modules/next/") || normalized.endsWith("/node_modules/next")) {
      forbidden.push(input);
      continue;
    }
    if (normalized.includes("node_modules/")) continue;
    if (!isInside(appRoot, absolute) && !isInside(packagesRoot, absolute)) forbidden.push(input);
  }
  if (forbidden.length > 0) {
    throw new Error(
      `Runtime artifact imported source outside apps/runtime-node and packages: ${forbidden.sort().join(", ")}.`,
    );
  }
}

/** The metafile is path-shaped; verify its resolved owners cannot escape the app/packages/repository closure. */
export async function assertRuntimeArtifactInputRealpathProvenance(
  metafile: Metafile,
  {
    appRoot = RUNTIME_NODE_APP_ROOT,
    repositoryRoot = REPOSITORY_ROOT,
  }: { readonly appRoot?: string; readonly repositoryRoot?: string } = {},
): Promise<void> {
  const packagesRoot = path.join(repositoryRoot, "packages");
  for (const input of Object.keys(metafile.inputs)) {
    const sourcePath = path.resolve(appRoot, input);
    const normalized = input.split(path.sep).join("/");
    let ownerPath: string;
    try {
      ownerPath = await realpath(sourcePath);
    } catch {
      throw new Error(`Runtime artifact bundle input is missing: ${input}.`);
    }
    if (!isInside(repositoryRoot, ownerPath)) {
      throw new Error(`Runtime artifact bundle input resolves outside the repository: ${input}.`);
    }
    if (normalized.includes("node_modules/")) {
      if (ownerPath.split(path.sep).includes("next"))
        throw new Error(`Runtime artifact bundle input resolves to Next.js: ${input}.`);
      continue;
    }
    if (!isInside(appRoot, ownerPath) && !isInside(packagesRoot, ownerPath)) {
      throw new Error(`Runtime artifact bundle input has an invalid source owner: ${input}.`);
    }
  }
}

function targetTriple(
  platform: NodeJS.Platform,
  arch: string,
  libc: "glibc" | "musl" | "none",
): string {
  if (platform === "darwin") return arch === "x64" ? "x86_64-apple-darwin" : "aarch64-apple-darwin";
  if (platform === "win32")
    return arch === "x64" ? "x86_64-pc-windows-msvc" : "aarch64-pc-windows-msvc";
  const cpu = arch === "x64" ? "x86_64" : "aarch64";
  return `${cpu}-unknown-linux-${libc === "glibc" ? "gnu" : "musl"}`;
}

function hostLibc(platform: NodeJS.Platform = process.platform): "glibc" | "musl" | "none" {
  if (platform !== "linux") return "none";
  const report = process.report?.getReport?.() as
    | { readonly header?: { readonly glibcVersionRuntime?: string } }
    | undefined;
  return report?.header?.glibcVersionRuntime ? "glibc" : "musl";
}

export function currentNodeArtifactTarget(): RuntimeArtifactTarget {
  if (
    !["darwin", "linux", "win32"].includes(process.platform) ||
    !["arm64", "x64"].includes(process.arch)
  ) {
    throw new Error(`Unsupported Runtime artifact target ${process.platform}-${process.arch}.`);
  }
  const libc = hostLibc();
  return Object.freeze({
    runtimeFlavor: "node",
    platform: process.platform as "darwin" | "linux" | "win32",
    arch: process.arch as "arm64" | "x64",
    targetTriple: targetTriple(process.platform, process.arch, libc),
    libc,
    nodeVersion: process.versions.node,
    nodeModuleAbi: Number(process.versions.modules),
    napiVersion: Number(process.versions.napi),
  });
}

export const runtimeArtifactTargetKey = contractRuntimeArtifactTargetKey;

export function outputDirectoryForTarget(
  target: RuntimeArtifactTarget,
  artifactRoot = DEFAULT_RUNTIME_ARTIFACT_DIRECTORY,
): string {
  return path.join(artifactRoot, runtimeArtifactTargetKey(target));
}

/** Node artifacts cannot claim an ABI that was not used to materialize them. */
export const currentNodeRuntimeArtifactAdapter: RuntimeArtifactTargetAdapter = Object.freeze({
  runtimeFlavor: "node",
  validateTarget(target: RuntimeArtifactTarget) {
    const current = currentNodeArtifactTarget();
    if (target.runtimeFlavor !== "node" || JSON.stringify(target) !== JSON.stringify(current)) {
      throw new Error(
        "Node Runtime artifact target must match the executing Node platform, version, ABI, and N-API version.",
      );
    }
  },
});

function validateTargetWithContract(target: RuntimeArtifactTarget): RuntimeArtifactTarget {
  // The public parser owns target discrimination and target-triple validation. The dummy inventory
  // is deliberately local and never written; final manifests receive a measured inventory below.
  return assertRuntimeArtifactManifest({
    schemaVersion: RUNTIME_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifactKind: "workbench-runtime-node",
    runtimeMode: "api-only",
    controlVersion: RUNTIME_HOST_CONTROL_VERSION,
    hostProtocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
    target,
    entrypoint: RUNTIME_ARTIFACT_ENTRYPOINT,
    externalPackages: [],
    dynamicPackages: [],
    resources: [],
    modelReadableResources: [],
    nativePackages: [],
    nativeInventory: {
      path: RUNTIME_ARTIFACT_NATIVE_INVENTORY_FILENAME,
      size: 1,
      sha256: "0".repeat(64),
    },
    links: [],
    upgradeRequiredPaths: RUNTIME_ARTIFACT_UPGRADE_PATHS,
  }).target;
}

function packageOwnerDirectory(packageName: string, appRoot: string): string {
  if (RUNTIME_ARTIFACT_NATIVE_PACKAGES.includes(packageName)) {
    const ownerManifest = path.join(
      path.resolve(appRoot, "../../packages/terminal/server"),
      "package.json",
    );
    return path.dirname(ownerManifest);
  }
  return appRoot;
}

async function resolvedPackageDirectory(packageName: string, appRoot: string): Promise<string> {
  if (packageName === "@earendil-works/pi-ai") {
    const piCodingAgentDirectory = await resolvedPackageDirectory(
      "@earendil-works/pi-coding-agent",
      appRoot,
    );
    const owner = JSON.parse(
      await readFile(path.join(piCodingAgentDirectory, "package.json"), "utf8"),
    ) as {
      readonly dependencies?: Record<string, string>;
    };
    if (!owner.dependencies?.[packageName]) {
      throw new Error(`${packageName} must be declared by @earendil-works/pi-coding-agent.`);
    }
    const nestedPackage = path.resolve(piCodingAgentDirectory, "../pi-ai");
    const manifest = JSON.parse(
      await readFile(path.join(nestedPackage, "package.json"), "utf8"),
    ) as { readonly name?: string };
    if (manifest.name !== packageName)
      throw new Error(`Resolved ${packageName} to a mismatched package.`);
    return realpath(nestedPackage);
  }
  const ownerDirectory = packageOwnerDirectory(packageName, appRoot);
  if (RUNTIME_ARTIFACT_NATIVE_PACKAGES.includes(packageName)) {
    const owner = JSON.parse(await readFile(path.join(ownerDirectory, "package.json"), "utf8")) as {
      readonly name?: string;
      readonly dependencies?: Record<string, string>;
    };
    if (owner.name !== "@workbench/terminal-server" || !owner.dependencies?.[packageName]) {
      throw new Error(`${packageName} must be declared by @workbench/terminal-server.`);
    }
  }
  const installedPackage = path.join(ownerDirectory, "node_modules", ...packageName.split("/"));
  try {
    const manifest = JSON.parse(
      await readFile(path.join(installedPackage, "package.json"), "utf8"),
    ) as { readonly name?: string };
    if (manifest.name === packageName) return realpath(installedPackage);
  } catch {
    /* resolve through Node below when the owner does not have a logical package link */
  }
  const requireFromOwner = createRequire(path.join(ownerDirectory, "package.json"));
  let entry: string;
  try {
    entry = requireFromOwner.resolve(`${packageName}/package.json`);
  } catch (error: unknown) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED"
    )
      throw error;
    entry = requireFromOwner.resolve(packageName);
  }
  let directory = path.dirname(entry);
  while (directory !== path.dirname(directory)) {
    try {
      const manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8")) as {
        readonly name?: string;
      };
      if (manifest.name === packageName) return await realpath(directory);
    } catch {
      /* walk upward until the package root */
    }
    directory = path.dirname(directory);
  }
  throw new Error(`Could not find package root for ${packageName}.`);
}

async function assertSourceInsideRepository(
  sourcePath: string,
  repositoryRoot: string,
  label: string,
): Promise<string> {
  const resolved = await realpath(sourcePath);
  if (!isInside(repositoryRoot, resolved))
    throw new Error(`${label} resolves outside the repository: ${resolved}.`);
  return resolved;
}

export function runtimeAppOwnedExternalTraceAliases({
  appRoot = RUNTIME_NODE_APP_ROOT,
  repositoryRoot = REPOSITORY_ROOT,
}: {
  readonly appRoot?: string;
  readonly repositoryRoot?: string;
} = {}): readonly RuntimeAppOwnedExternalTraceAlias[] {
  return Object.freeze(
    RUNTIME_ARTIFACT_APP_OWNED_EXTERNAL_PACKAGES.map((packageName) =>
      Object.freeze({
        packageName,
        sourceRelativePath: artifactRelativePath(
          path.relative(
            repositoryRoot,
            path.join(appRoot, "node_modules", ...packageName.split("/")),
          ),
        ),
        destinationRelativePath: artifactRelativePath(path.posix.join("node_modules", packageName)),
      }),
    ),
  );
}

export async function resolveRuntimeAppExternalTraceAuthority({
  appRoot = RUNTIME_NODE_APP_ROOT,
  repositoryRoot = REPOSITORY_ROOT,
}: {
  readonly appRoot?: string;
  readonly repositoryRoot?: string;
} = {}): Promise<
  Readonly<{
    issuerPath: string;
    packageNames: readonly string[];
    aliases: readonly RuntimeAppOwnedExternalTraceAlias[];
  }>
> {
  const issuerPath = await assertSourceInsideRepository(
    path.join(appRoot, "package.json"),
    repositoryRoot,
    "Runtime app manifest",
  );
  const appManifest = JSON.parse(await readFile(issuerPath, "utf8")) as {
    readonly name?: string;
    readonly dependencies?: Record<string, unknown>;
  };
  if (appManifest.name !== "@workbench/runtime-node") {
    throw new Error("Runtime app trace owner must be @workbench/runtime-node.");
  }

  const aliases = runtimeAppOwnedExternalTraceAliases({ appRoot, repositoryRoot });
  for (const { packageName, sourceRelativePath } of aliases) {
    const declaredVersion = appManifest.dependencies?.[packageName];
    if (typeof declaredVersion !== "string" || declaredVersion.length === 0) {
      throw new Error(
        `${packageName} must be a direct production dependency of @workbench/runtime-node.`,
      );
    }
    const installedPackagePath = path.join(repositoryRoot, ...sourceRelativePath.split("/"));
    const installedPackageStats = await lstat(installedPackagePath);
    if (!installedPackageStats.isSymbolicLink()) {
      throw new Error(
        `Runtime app dependency ${packageName} must be installed through its public pnpm symlink.`,
      );
    }
    const installedPackage = await assertSourceInsideRepository(
      installedPackagePath,
      repositoryRoot,
      `${packageName} Runtime app installation`,
    );
    const installedManifestPath = await assertSourceInsideRepository(
      path.join(installedPackage, "package.json"),
      repositoryRoot,
      `${packageName} installed manifest`,
    );
    const installedManifest = JSON.parse(await readFile(installedManifestPath, "utf8")) as {
      readonly name?: string;
    };
    if (installedManifest.name !== packageName) {
      throw new Error(`Runtime app dependency ${packageName} resolved to a mismatched package.`);
    }
  }

  return Object.freeze({
    issuerPath,
    packageNames: RUNTIME_ARTIFACT_APP_OWNED_EXTERNAL_PACKAGES,
    aliases,
  });
}

export async function resolveTreeSitterTraceTarget({
  appRoot = RUNTIME_NODE_APP_ROOT,
  repositoryRoot = REPOSITORY_ROOT,
  target,
}: {
  readonly appRoot?: string;
  readonly repositoryRoot?: string;
  readonly target: RuntimeArtifactTarget;
}): Promise<Readonly<{ issuerPath: string; binaryPath: string }>> {
  const packageDirectory = await resolvedPackageDirectory("tree-sitter", appRoot);
  await assertSourceInsideRepository(packageDirectory, repositoryRoot, "tree-sitter package");
  const issuerPath = path.join(packageDirectory, "index.js");
  const tuple = `${target.platform}-${target.arch}`;
  const targetDirectory = path.join(packageDirectory, "prebuilds", tuple);
  const entries = await readdir(targetDirectory, { withFileTypes: true });
  if (entries.length !== 1 || entries[0]?.name !== "tree-sitter.node" || !entries[0].isFile()) {
    throw new Error(
      `tree-sitter must have exactly one ${tuple} native winner named tree-sitter.node.`,
    );
  }
  const binaryPath = await assertSourceInsideRepository(
    path.join(targetDirectory, "tree-sitter.node"),
    repositoryRoot,
    "tree-sitter native winner",
  );
  return Object.freeze({ issuerPath: await realpath(issuerPath), binaryPath });
}

export async function createRuntimeArtifactTraceResolver({
  appRoot = RUNTIME_NODE_APP_ROOT,
  repositoryRoot = REPOSITORY_ROOT,
  target,
  resolveDependency,
}: {
  readonly appRoot?: string;
  readonly repositoryRoot?: string;
  readonly target: RuntimeArtifactTarget;
  readonly resolveDependency: NodeFileTraceResolver;
}): Promise<NodeFileTraceResolver> {
  const treeSitter = await resolveTreeSitterTraceTarget({ appRoot, repositoryRoot, target });
  const terminalNativeOwner = await assertSourceInsideRepository(
    packageOwnerDirectory(RUNTIME_ARTIFACT_NATIVE_PACKAGES[0], appRoot),
    repositoryRoot,
    "Terminal native package owner",
  );
  const terminalNativeIssuer = await assertSourceInsideRepository(
    path.join(terminalNativeOwner, "package.json"),
    repositoryRoot,
    "Terminal native package owner manifest",
  );
  const runtimeAppExternalAuthority = await resolveRuntimeAppExternalTraceAuthority({
    appRoot,
    repositoryRoot,
  });
  for (const packageName of RUNTIME_ARTIFACT_NATIVE_PACKAGES) {
    await assertSourceInsideRepository(
      await resolvedPackageDirectory(packageName, appRoot),
      repositoryRoot,
      `${packageName} trace package`,
    );
  }
  const piCodingAgentDirectory = await resolvedPackageDirectory(
    "@earendil-works/pi-coding-agent",
    appRoot,
  );
  const piAiEntry = path.join(
    await resolvedPackageDirectory("@earendil-works/pi-ai", appRoot),
    "dist",
    "index.js",
  );
  return async (specifier, parent, job, cjsResolve) => {
    // The Terminal Server leaf is the sole manifest owner for ABI-sensitive packages.  The
    // emitted server lives in an isolated candidate without node_modules, so NFT must resolve
    // these bare externals from that declared owner instead of relying on a repository-root hoist.
    // NFT still performs the actual conditional import/require resolution and traces the physical
    // pnpm closure; this changes only the issuer authority used for the three exact package names.
    if (RUNTIME_ARTIFACT_NATIVE_PACKAGES.includes(specifier)) {
      return resolveDependency(specifier, terminalNativeIssuer, job, cjsResolve);
    }
    const packageName = packageNameForSpecifier(specifier);
    if (packageName && runtimeAppExternalAuthority.packageNames.includes(packageName)) {
      return resolveDependency(specifier, runtimeAppExternalAuthority.issuerPath, job, cjsResolve);
    }
    if (specifier === TREE_SITTER_DYNAMIC_PREBUILD_DEPENDENCY && parent === treeSitter.issuerPath) {
      return treeSitter.binaryPath;
    }
    // NFT invokes CJS resolution for this ESM-only dynamic import. Pi owns and copies the full
    // published package below, while this exact entry lets NFT follow its ordinary dependencies.
    if (specifier === "@earendil-works/pi-ai") return piAiEntry;
    if (specifier === "@earendil-works/pi-coding-agent")
      return path.join(piCodingAgentDirectory, "dist", "index.js");
    return resolveDependency(specifier, parent, job, cjsResolve);
  };
}

function isAllowedTraceWarning(warning: Error): boolean {
  const message = String(warning);
  return (
    message.includes('Failed to resolve dependency "bufferutil"') ||
    message.includes('Failed to resolve dependency "utf-8-validate"') ||
    (message.includes('No "exports" main defined') &&
      message.includes("@earendil-works/pi-ai/package.json")) ||
    (message.includes("@earendil-works+pi-ai") &&
      message.includes("Cannot use 'import.meta' outside a module"))
  );
}

type ArtifactPathApi = Pick<typeof path, "dirname" | "isAbsolute" | "relative" | "resolve" | "sep">;

/** Maps even an absolute source junction target onto the corresponding relocatable artifact path. */
export function artifactLocalLinkTarget(
  sourceRealPath: string,
  destinationPath: string,
  repositoryRoot: string,
  outputDirectory: string,
  pathApi: ArtifactPathApi = path,
): string {
  const sourceRelative = pathApi.relative(
    pathApi.resolve(repositoryRoot),
    pathApi.resolve(sourceRealPath),
  );
  if (
    sourceRelative === ".." ||
    sourceRelative.startsWith(`..${pathApi.sep}`) ||
    pathApi.isAbsolute(sourceRelative)
  ) {
    throw new Error(`Traced link target resolves outside the repository: ${sourceRealPath}.`);
  }
  const artifactTarget = pathApi.resolve(outputDirectory, sourceRelative);
  const relativeTarget = pathApi.relative(pathApi.dirname(destinationPath), artifactTarget);
  if (!relativeTarget || pathApi.isAbsolute(relativeTarget)) {
    throw new Error(
      `Traced link target cannot be represented inside the artifact: ${sourceRealPath}.`,
    );
  }
  return relativeTarget.split(pathApi.sep).join("/");
}

export async function copyRuntimeArtifactClosurePath(
  relativePath: string,
  repositoryRoot: string,
  outputDirectory: string,
): Promise<void> {
  const safePath = artifactRelativePath(relativePath);
  const sourcePath = path.join(repositoryRoot, ...safePath.split("/"));
  const sourceRealPath = await assertSourceInsideRepository(
    sourcePath,
    repositoryRoot,
    `Traced source ${safePath}`,
  );
  const destinationPath = path.join(outputDirectory, ...safePath.split("/"));
  const stats = await lstat(sourcePath);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  if (stats.isSymbolicLink()) {
    const targetStats = await lstat(sourceRealPath);
    if (!targetStats.isDirectory() && !targetStats.isFile()) {
      throw new Error(`Unsupported traced link target: ${safePath}.`);
    }
    await rm(destinationPath, { force: true, recursive: true });
    await symlink(
      artifactLocalLinkTarget(sourceRealPath, destinationPath, repositoryRoot, outputDirectory),
      destinationPath,
      targetStats.isDirectory() ? "dir" : "file",
    );
  } else if (stats.isDirectory()) {
    await mkdir(destinationPath, { recursive: true });
  } else if (stats.isFile()) {
    await copyFile(sourcePath, destinationPath);
  } else {
    throw new Error(`Unsupported traced filesystem entry: ${safePath}.`);
  }
}

/**
 * Recreates pnpm's package-local dependency links only when NFT copied both physical owners.
 * NFT traces the real files behind Windows junctions, but it can omit the issuer-side junction;
 * without that link Node cannot resolve a dependency from the copied `.pnpm` package directory.
 */
export async function projectTracedPnpmDependencyLinks({
  repositoryRoot = REPOSITORY_ROOT,
  outputDirectory,
}: {
  readonly repositoryRoot?: string;
  readonly outputDirectory: string;
}): Promise<void> {
  const sourcePnpmRoot = path.join(repositoryRoot, "node_modules", ".pnpm");
  const artifactPnpmRoot = path.join(outputDirectory, "node_modules", ".pnpm");
  const dependencyLinks = async (ownerDirectory: string): Promise<readonly string[]> => {
    const nodeModulesDirectory = path.join(ownerDirectory, "node_modules");
    const result: string[] = [];
    for (const entry of await readdir(nodeModulesDirectory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        result.push(entry.name);
        continue;
      }
      if (!entry.isDirectory() || !entry.name.startsWith("@")) continue;
      for (const scopedEntry of await readdir(path.join(nodeModulesDirectory, entry.name), {
        withFileTypes: true,
      })) {
        if (scopedEntry.isSymbolicLink()) result.push(path.join(entry.name, scopedEntry.name));
      }
    }
    return Object.freeze(result.sort());
  };

  for (const owner of await readdir(artifactPnpmRoot, { withFileTypes: true })) {
    if (!owner.isDirectory()) continue;
    const sourceOwner = path.join(sourcePnpmRoot, owner.name);
    const artifactOwner = path.join(artifactPnpmRoot, owner.name);
    await assertSourceInsideRepository(sourceOwner, repositoryRoot, `pnpm owner ${owner.name}`);
    for (const dependencyLink of await dependencyLinks(sourceOwner)) {
      const sourceLink = path.join(sourceOwner, "node_modules", dependencyLink);
      const sourceTarget = await assertSourceInsideRepository(
        sourceLink,
        repositoryRoot,
        `pnpm dependency link ${owner.name}/${dependencyLink}`,
      );
      const artifactTarget = path.join(
        outputDirectory,
        path.relative(repositoryRoot, sourceTarget),
      );
      let artifactTargetRealPath: string;
      try {
        artifactTargetRealPath = await assertSourceInsideRepository(
          artifactTarget,
          outputDirectory,
          `traced pnpm dependency target ${owner.name}/${dependencyLink}`,
        );
      } catch (error: unknown) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
        throw error;
      }
      const destinationPath = path.join(artifactOwner, "node_modules", dependencyLink);
      try {
        const destinationStats = await lstat(destinationPath);
        if (!destinationStats.isSymbolicLink()) {
          throw new Error(
            `Traced pnpm dependency destination is not a link: ${owner.name}/${dependencyLink}.`,
          );
        }
        if ((await realpath(destinationPath)) !== artifactTargetRealPath) {
          throw new Error(
            `Traced pnpm dependency link has the wrong target: ${owner.name}/${dependencyLink}.`,
          );
        }
        continue;
      } catch (error: unknown) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      }
      await mkdir(path.dirname(destinationPath), { recursive: true });
      const targetStats = await lstat(artifactTargetRealPath);
      await symlink(
        path
          .relative(path.dirname(destinationPath), artifactTargetRealPath)
          .split(path.sep)
          .join("/"),
        destinationPath,
        targetStats.isDirectory() ? "dir" : "file",
      );
    }
  }
}

export async function projectRuntimeAppOwnedExternalTraceAliases({
  tracedPaths,
  appRoot = RUNTIME_NODE_APP_ROOT,
  repositoryRoot = REPOSITORY_ROOT,
  outputDirectory,
}: {
  readonly tracedPaths: readonly string[];
  readonly appRoot?: string;
  readonly repositoryRoot?: string;
  readonly outputDirectory: string;
}): Promise<void> {
  const normalizedTraces = new Set(
    tracedPaths.map((relativePath) => artifactRelativePath(relativePath)),
  );
  for (const alias of runtimeAppOwnedExternalTraceAliases({ appRoot, repositoryRoot })) {
    if (!normalizedTraces.has(alias.sourceRelativePath)) {
      throw new Error(
        `NFT closure is missing Runtime app public alias ${alias.packageName}: ${alias.sourceRelativePath}.`,
      );
    }

    const sourceAliasPath = path.join(repositoryRoot, ...alias.sourceRelativePath.split("/"));
    const sourceAliasStats = await lstat(sourceAliasPath);
    if (!sourceAliasStats.isSymbolicLink()) {
      throw new Error(`Runtime app public alias ${alias.packageName} must be a symbolic link.`);
    }
    const sourceOwnerPath = await assertSourceInsideRepository(
      sourceAliasPath,
      repositoryRoot,
      `${alias.packageName} traced package owner`,
    );
    const sourceOwnerStats = await lstat(sourceOwnerPath);
    if (!sourceOwnerStats.isDirectory()) {
      throw new Error(`Runtime app public alias ${alias.packageName} must target a directory.`);
    }
    const sourceOwnerRelativePath = artifactRelativePath(
      path.relative(repositoryRoot, sourceOwnerPath),
    );
    const artifactOwnerPath = path.join(outputDirectory, ...sourceOwnerRelativePath.split("/"));
    let artifactOwnerRealPath: string;
    try {
      artifactOwnerRealPath = await assertSourceInsideRepository(
        artifactOwnerPath,
        outputDirectory,
        `${alias.packageName} traced artifact owner`,
      );
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new Error(
          `NFT closure is missing traced physical owner for Runtime app package ${alias.packageName}.`,
        );
      }
      throw error;
    }
    if (!(await lstat(artifactOwnerRealPath)).isDirectory()) {
      throw new Error(`Traced artifact owner for ${alias.packageName} must be a directory.`);
    }

    const destinationPath = path.join(outputDirectory, ...alias.destinationRelativePath.split("/"));
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await assertSourceInsideRepository(
      path.dirname(destinationPath),
      outputDirectory,
      `${alias.packageName} artifact alias parent`,
    );
    try {
      await lstat(destinationPath);
      throw new Error(`Runtime artifact alias already exists for ${alias.packageName}.`);
    } catch (error: unknown) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    await symlink(
      artifactLocalLinkTarget(sourceOwnerPath, destinationPath, repositoryRoot, outputDirectory),
      destinationPath,
      "dir",
    );
    if ((await realpath(destinationPath)) !== artifactOwnerRealPath) {
      throw new Error(`Runtime artifact alias for ${alias.packageName} has the wrong owner.`);
    }
  }
}

async function copyDynamicPackage(
  packageName: string,
  appRoot: string,
  repositoryRoot: string,
  outputDirectory: string,
): Promise<void> {
  const sourceDirectory = await resolvedPackageDirectory(packageName, appRoot);
  await assertSourceInsideRepository(
    sourceDirectory,
    repositoryRoot,
    `${packageName} dynamic package`,
  );
  await overlayTracedPackage(packageName, sourceDirectory, repositoryRoot, outputDirectory);
}

async function copyOwnedPackage(
  packageName: string,
  appRoot: string,
  repositoryRoot: string,
  outputDirectory: string,
): Promise<void> {
  const sourceDirectory = await resolvedPackageDirectory(packageName, appRoot);
  await assertSourceInsideRepository(sourceDirectory, repositoryRoot, `${packageName} package`);
  await overlayTracedPackage(packageName, sourceDirectory, repositoryRoot, outputDirectory);
}

/**
 * `fs.cp({ dereference: true })` follows every package-internal link.  Prove the complete source
 * tree is owned by both the resolved package and repository before allowing that operation.
 */
export async function assertPackageOverlaySourceProvenance(
  sourceDirectory: string,
  repositoryRoot: string,
): Promise<string> {
  const canonicalRepositoryRoot = await realpath(repositoryRoot);
  if (canonicalRepositoryRoot !== repositoryRoot) {
    throw new Error("Runtime artifact repository root must be canonical.");
  }
  const canonicalPackageRoot = await realpath(sourceDirectory);
  if (!isInside(canonicalRepositoryRoot, canonicalPackageRoot)) {
    throw new Error(`Runtime package source resolves outside the repository: ${sourceDirectory}.`);
  }

  const visitedDirectories = new Set<string>();
  const walk = async (directory: string): Promise<void> => {
    const canonicalDirectory = await realpath(directory);
    if (
      !isInside(canonicalRepositoryRoot, canonicalDirectory) ||
      !isInside(canonicalPackageRoot, canonicalDirectory)
    ) {
      throw new Error(
        `Runtime package source entry escapes its canonical package/repository: ${directory}.`,
      );
    }
    if (visitedDirectories.has(canonicalDirectory)) return;
    visitedDirectories.add(canonicalDirectory);

    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const sourcePath = path.join(directory, entry.name);
      const canonicalSourcePath = await realpath(sourcePath);
      if (
        !isInside(canonicalRepositoryRoot, canonicalSourcePath) ||
        !isInside(canonicalPackageRoot, canonicalSourcePath)
      ) {
        throw new Error(
          `Runtime package source entry escapes its canonical package/repository: ${sourcePath}.`,
        );
      }
      const stats = await lstat(sourcePath);
      if (stats.isDirectory()) {
        await walk(sourcePath);
      } else if (stats.isSymbolicLink()) {
        const targetStats = await lstat(canonicalSourcePath);
        if (targetStats.isDirectory()) await walk(canonicalSourcePath);
        else if (!targetStats.isFile()) {
          throw new Error(`Runtime package source contains an unsupported link: ${sourcePath}.`);
        }
      } else if (!stats.isFile()) {
        throw new Error(`Runtime package source contains an unsupported entry: ${sourcePath}.`);
      }
    }
  };

  await walk(canonicalPackageRoot);
  return canonicalPackageRoot;
}

/** Replaces package content behind NFT's already-copied public pnpm alias without flattening it. */
async function overlayTracedPackage(
  packageName: string,
  sourceDirectory: string,
  repositoryRoot: string,
  outputDirectory: string,
): Promise<void> {
  const runtimeLink = path.join(outputDirectory, "node_modules", ...packageName.split("/"));
  let runtimeDirectory: string;
  try {
    runtimeDirectory = await realpath(runtimeLink);
  } catch {
    // NFT can trace an ESM-only entry by its real pnpm store path without emitting the public
    // alias. Recreate an artifact-local alias to that traced owner path, never a root hoist.
    let copiedOwnerPath: string;
    try {
      const sourceRelative = artifactRelativePath(path.relative(repositoryRoot, sourceDirectory));
      copiedOwnerPath = path.join(outputDirectory, ...sourceRelative.split("/"));
      await lstat(copiedOwnerPath);
    } catch {
      throw new Error(`NFT closure is missing public runtime package link ${packageName}.`);
    }
    await mkdir(path.dirname(runtimeLink), { recursive: true });
    await symlink(
      path.relative(path.dirname(runtimeLink), copiedOwnerPath).split(path.sep).join("/"),
      runtimeLink,
      "dir",
    );
    try {
      runtimeDirectory = await realpath(runtimeLink);
    } catch {
      throw new Error(`NFT closure is missing symlink target for runtime package ${packageName}.`);
    }
  }
  if (!isInside(outputDirectory, runtimeDirectory))
    throw new Error(`Runtime package link ${packageName} escapes the artifact.`);
  const canonicalSourceDirectory = await assertPackageOverlaySourceProvenance(
    sourceDirectory,
    repositoryRoot,
  );
  await cp(canonicalSourceDirectory, runtimeDirectory, {
    dereference: true,
    force: true,
    recursive: true,
  });
}

export interface RuntimeModelReadableResources {
  /** Actual final regular-file closure beneath Pi's README.md, docs, and examples roots. */
  readonly resources: readonly string[];
  /** Physical artifact-relative root after resolving the public pnpm alias. */
  readonly resolvedExamplesRoot: string;
}

export interface RuntimePruneOptions {
  /** Artifact-relative pre-prune model closure. TS/test exceptions only apply inside examples. */
  readonly modelReadableResources?: readonly string[];
  readonly resolvedExamplesRoot?: string;
}

function shouldPrune(
  relativePath: string,
  { modelReadableResources = [], resolvedExamplesRoot = "" }: RuntimePruneOptions = {},
): boolean {
  if (/(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json)$/u.test(relativePath)) return true;
  if (relativePath.endsWith(".map") || relativePath.endsWith(".pdb")) return true;
  if (!modelResourceTools.isTypeScriptOrTestPath(relativePath)) return false;
  return !modelResourceTools.isRuntimeArtifactModelReadableException(
    relativePath,
    modelReadableResources,
    resolvedExamplesRoot,
  );
}

export async function pruneRuntimeTree(
  directory: string,
  root = directory,
  options: RuntimePruneOptions = {},
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = artifactRelativePath(path.relative(root, absolute));
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (shouldPrune(relative, options)) await rm(absolute, { force: true, recursive: true });
      else await pruneRuntimeTree(absolute, root, options);
    } else if (entry.isFile() && shouldPrune(relative, options))
      await rm(absolute, { force: true });
  }
}

async function pruneKnownNativeVariants(
  outputDirectory: string,
  target: RuntimeArtifactTarget,
  repositoryRoot: string,
): Promise<void> {
  for (const packageName of RUNTIME_ARTIFACT_NATIVE_PACKAGES) {
    const packageDirectory = await realpath(
      path.join(outputDirectory, "node_modules", packageName),
    );
    nativeTools.prunePackageNativeVariants(packageDirectory, packageName, target, {
      nativeBuildManifestPath: process.env[nativeTools.NODE_PTY_NATIVE_BUILD_MANIFEST_ENV],
      repositoryRoot,
    });
  }
}

async function regularFiles(
  directory: string,
  root = directory,
  result: string[] = [],
): Promise<string[]> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await regularFiles(absolute, root, result);
    else if (entry.isFile()) result.push(artifactRelativePath(path.relative(root, absolute)));
  }
  return result;
}

export async function normalizeRuntimeArtifactPermissions(directory: string): Promise<void> {
  // Installed artifacts are owned by root but must remain readable by the launching user.
  await chmod(directory, 0o755);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await normalizeRuntimeArtifactPermissions(absolute);
    else if (entry.isFile()) {
      const { mode } = await lstat(absolute);
      await chmod(absolute, mode & 0o111 ? 0o755 : 0o644);
    }
  }
}

export async function collectRuntimeModelReadableResources(
  outputDirectory: string,
): Promise<RuntimeModelReadableResources> {
  return runtimeArtifactAdmissionPolicy.collectModelReadableResources({
    artifactRoot: outputDirectory,
  });
}

export function assertRuntimeModelReadableResourceClassification({
  resources,
  modelReadableResources,
  expectedModelReadableResources,
  resolvedExamplesRoot,
}: {
  readonly resources: readonly string[];
  readonly modelReadableResources: readonly string[];
  readonly expectedModelReadableResources: readonly string[];
  readonly resolvedExamplesRoot: string;
}): void {
  runtimeArtifactAdmissionPolicy.assertModelReadableResourceClassification({
    resources,
    modelReadableResources,
    expectedModelReadableResources,
    resolvedExamplesRoot,
  });
}

async function runtimeTraceEntries(appRoot: string): Promise<readonly string[]> {
  const entries: string[] = [];
  for (const packageName of RUNTIME_ARTIFACT_DYNAMIC_PACKAGES) {
    const distDirectory = path.join(await resolvedPackageDirectory(packageName, appRoot), "dist");
    for (const relativePath of await regularFiles(distDirectory)) {
      if (/\.(?:[cm]?js)$/u.test(relativePath))
        entries.push(path.join(distDirectory, ...relativePath.split("/")));
    }
  }
  return Object.freeze(entries.sort());
}

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

export async function writeNativeInventory(
  outputDirectory: string,
  target: RuntimeArtifactTarget,
): Promise<
  Readonly<{
    inventory: RuntimeArtifactNativeInventory;
    reference: { path: string; size: number; sha256: string };
    nativePackages: readonly string[];
  }>
> {
  for (const expectedFile of runtimeArtifactAdmissionPolicy.expectedNativeRuntimeFiles(target)) {
    const expectedPath = `node_modules/${expectedFile.packageName}/${expectedFile.relativePath}`;
    const expectedAbsolute = path.join(outputDirectory, ...expectedPath.split("/"));
    try {
      const expectedStats = await lstat(expectedAbsolute);
      if (
        !expectedStats.isFile() ||
        !isInside(outputDirectory, await realpath(expectedAbsolute)) ||
        (expectedFile.executable && (expectedStats.mode & 0o111) === 0)
      ) {
        throw new Error(`Runtime artifact is missing required native file ${expectedPath}.`);
      }
    } catch {
      throw new Error(`Runtime artifact is missing required native file ${expectedPath}.`);
    }
    if (target.platform !== "win32") {
      await chmod(expectedAbsolute, expectedFile.executable ? 0o755 : 0o644);
    }
  }
  const files = nativeTools.collectNativeRuntimeInventory(outputDirectory);
  const inventory: RuntimeArtifactNativeInventory = assertRuntimeArtifactNativeInventory({
    schemaVersion: 1,
    target,
    files: Object.freeze(files.map((file) => Object.freeze({ ...file }))),
  });
  const inventoryPath = path.join(outputDirectory, RUNTIME_ARTIFACT_NATIVE_INVENTORY_FILENAME);
  await writeFile(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
  const stats = await lstat(inventoryPath);
  const nativePackages = [
    ...new Set(
      files
        .map((file) => {
          const segments = file.path.split("/");
          const nodeModules = segments.lastIndexOf("node_modules");
          return nodeModules < 0
            ? undefined
            : segments[nodeModules + 1] === "@"
              ? undefined
              : segments[nodeModules + 1]?.startsWith("@")
                ? `${segments[nodeModules + 1]}/${segments[nodeModules + 2]}`
                : segments[nodeModules + 1];
        })
        .filter((value): value is string => value !== undefined),
    ),
  ].sort();
  return Object.freeze({
    inventory,
    reference: Object.freeze({
      path: RUNTIME_ARTIFACT_NATIVE_INVENTORY_FILENAME,
      size: stats.size,
      sha256: await sha256(inventoryPath),
    }),
    nativePackages: Object.freeze(nativePackages),
  });
}

export async function assertArtifactConfinement(outputDirectory: string): Promise<void> {
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await realpath(absolute);
        if (!isInside(outputDirectory, target))
          throw new Error(
            `Artifact symlink escapes its closure: ${artifactRelativePath(path.relative(outputDirectory, absolute))}.`,
          );
      } else if (entry.isDirectory()) await walk(absolute);
    }
  }
  await walk(outputDirectory);
}

async function assertFinalArtifactPackageBoundary(outputDirectory: string): Promise<void> {
  const files = await regularFiles(outputDirectory);
  const forbidden = files.filter(
    (file) =>
      file.startsWith("node_modules/next/") ||
      file.includes("/node_modules/next/") ||
      file.startsWith("node_modules/@workbench/") ||
      file.includes("/node_modules/@workbench/"),
  );
  if (forbidden.length > 0) {
    throw new Error(
      `Runtime artifact contains forbidden package files: ${forbidden.sort().join(", ")}.`,
    );
  }
}

async function finalArtifactResources(outputDirectory: string): Promise<readonly string[]> {
  const resources = (await regularFiles(outputDirectory))
    .filter((file) =>
      isRuntimeArtifactResourcePath(file, {
        entrypoint: RUNTIME_ARTIFACT_ENTRYPOINT,
        nativeInventoryPath: RUNTIME_ARTIFACT_NATIVE_INVENTORY_FILENAME,
      }),
    )
    .sort();
  if (resources.length > 4_096)
    throw new Error(
      `Runtime artifact resource inventory exceeds the manifest limit: ${resources.length}.`,
    );
  return Object.freeze(resources);
}

async function finalArtifactLinks(
  outputDirectory: string,
): Promise<readonly { readonly path: string; readonly target: string }[]> {
  const links: { path: string; target: string }[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        links.push({
          path: artifactRelativePath(path.relative(outputDirectory, absolute)),
          target: (await readlink(absolute)).split(path.sep).join("/"),
        });
      } else if (entry.isDirectory()) {
        await walk(absolute);
      }
    }
  }
  await walk(outputDirectory);
  links.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  if (links.length > 4_096) {
    throw new Error(`Runtime artifact link inventory exceeds the manifest limit: ${links.length}.`);
  }
  return Object.freeze(links.map((link) => Object.freeze(link)));
}

async function copyDereferencedRuntimeEntry(
  source: string,
  destination: string,
  artifactRoot: string,
  ancestors: ReadonlySet<string>,
): Promise<void> {
  const resolvedSource = await realpath(source);
  if (!isInside(artifactRoot, resolvedSource)) {
    throw new Error(`Runtime artifact link target escapes its closure: ${source}.`);
  }
  const stats = await lstat(resolvedSource);
  if (stats.isFile()) {
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(resolvedSource, destination);
    await chmod(destination, stats.mode & 0o777);
    return;
  }
  if (!stats.isDirectory()) {
    throw new Error(`Runtime artifact link target is not a regular file or directory: ${source}.`);
  }
  if (ancestors.has(resolvedSource)) {
    throw new Error(`Runtime artifact link target contains a directory cycle: ${source}.`);
  }
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(resolvedSource);
  await mkdir(destination);
  await chmod(destination, stats.mode & 0o777);
  const entries = await readdir(resolvedSource, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    await copyDereferencedRuntimeEntry(
      path.join(resolvedSource, entry.name),
      path.join(destination, entry.name),
      artifactRoot,
      nextAncestors,
    );
  }
}

interface RuntimeArtifactLink {
  readonly path: string;
  readonly target: string;
}

interface StandalonePackageNode {
  readonly key: string;
  readonly root: string;
  readonly name: string;
  readonly version: string;
  readonly dependencies: Map<string, StandalonePackageNode>;
  referenceCount: number;
}

function packageOwnerNodeModules(packageRoot: string, packageName: string, label: string): string {
  let owner = packageRoot;
  const segments = packageName.split("/");
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (path.basename(owner) !== segments[index]) {
      throw new Error(`${label} does not end with its package name ${packageName}.`);
    }
    owner = path.dirname(owner);
  }
  if (path.basename(owner) !== "node_modules") {
    throw new Error(`${label} is not installed beneath node_modules.`);
  }
  return owner;
}

function setStandaloneRequirement(
  requirements: Map<string, StandalonePackageNode>,
  dependency: StandalonePackageNode,
  label: string,
): void {
  const existing = requirements.get(dependency.name);
  if (existing && existing.key !== dependency.key) {
    throw new Error(
      `${label} resolves ${dependency.name} to both ${existing.version} and ${dependency.version}.`,
    );
  }
  requirements.set(dependency.name, dependency);
}

async function copyStandalonePackage(
  node: StandalonePackageNode,
  destination: string,
  artifactRoot: string,
  placements: Map<string, string>,
): Promise<void> {
  const normalizedDestination = path.resolve(destination);
  const existing = placements.get(normalizedDestination);
  if (existing) {
    if (existing !== node.key) {
      throw new Error(`Standalone Runtime package placement collides at ${destination}.`);
    }
    return;
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await copyDereferencedRuntimeEntry(node.root, destination, artifactRoot, new Set());
  placements.set(normalizedDestination, node.key);
}

async function materializeStandaloneDependencies(
  node: StandalonePackageNode,
  destination: string,
  available: ReadonlyMap<string, StandalonePackageNode>,
  artifactRoot: string,
  placements: Map<string, string>,
  hydrated: Set<string>,
): Promise<void> {
  const hydrationKey = `${path.resolve(destination)}\0${node.key}`;
  if (hydrated.has(hydrationKey)) return;
  hydrated.add(hydrationKey);

  const localDependencies = [...node.dependencies.values()]
    .filter((dependency) => available.get(dependency.name)?.key !== dependency.key)
    .sort((left, right) => left.name.localeCompare(right.name));
  const locallyAvailable = new Map(available);
  for (const dependency of localDependencies) {
    const dependencyDestination = path.join(
      destination,
      "node_modules",
      ...dependency.name.split("/"),
    );
    await copyStandalonePackage(dependency, dependencyDestination, artifactRoot, placements);
    locallyAvailable.set(dependency.name, dependency);
  }
  for (const dependency of localDependencies) {
    await materializeStandaloneDependencies(
      dependency,
      path.join(destination, "node_modules", ...dependency.name.split("/")),
      locallyAvailable,
      artifactRoot,
      placements,
      hydrated,
    );
  }
}

/**
 * Converts the pruned pnpm dependency graph into a link-free Node.js layout. Windows installers
 * cannot preserve pnpm directory links, so every selected package is hoisted once and only version
 * conflicts are nested beneath their issuer. The resulting Runtime is installer-independent.
 */
export async function flattenWindowsRuntimeNodeModules(
  outputDirectory: string,
  links: readonly RuntimeArtifactLink[],
): Promise<void> {
  const artifactRoot = path.resolve(outputDirectory);
  const rootNodeModules = path.join(artifactRoot, "node_modules");
  const nodesByRoot = new Map<string, StandalonePackageNode>();
  const records: {
    readonly linkPath: string;
    readonly ownerNodeModules: string;
    readonly node: StandalonePackageNode;
  }[] = [];

  for (const linkEntry of links) {
    const linkPath = path.resolve(artifactRoot, ...linkEntry.path.split("/"));
    if (!isInside(artifactRoot, linkPath)) {
      throw new Error(`Runtime artifact link path escapes its closure: ${linkEntry.path}.`);
    }
    const stats = await lstat(linkPath);
    if (
      !stats.isSymbolicLink() ||
      (await readlink(linkPath)).split(path.sep).join("/") !== linkEntry.target
    ) {
      throw new Error(`Runtime artifact link changed before flattening: ${linkEntry.path}.`);
    }
    const packageRoot = await realpath(linkPath);
    if (!isInside(artifactRoot, packageRoot)) {
      throw new Error(`Runtime artifact link target escapes its closure: ${linkEntry.path}.`);
    }
    const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as {
      readonly name?: unknown;
      readonly version?: unknown;
    };
    if (
      typeof manifest.name !== "string" ||
      manifest.name.length === 0 ||
      typeof manifest.version !== "string" ||
      manifest.version.length === 0
    ) {
      throw new Error(`Runtime artifact link is not a versioned package: ${linkEntry.path}.`);
    }
    packageOwnerNodeModules(linkPath, manifest.name, `Runtime artifact link ${linkEntry.path}`);
    const key = path.resolve(packageRoot);
    let node = nodesByRoot.get(key);
    if (!node) {
      node = {
        key,
        root: packageRoot,
        name: manifest.name,
        version: manifest.version,
        dependencies: new Map(),
        referenceCount: 0,
      };
      nodesByRoot.set(key, node);
    } else if (node.name !== manifest.name || node.version !== manifest.version) {
      throw new Error(`Runtime package identity changed across links: ${linkEntry.path}.`);
    }
    node.referenceCount += 1;
    records.push({
      linkPath,
      ownerNodeModules: packageOwnerNodeModules(
        linkPath,
        manifest.name,
        `Runtime artifact link ${linkEntry.path}`,
      ),
      node,
    });
  }

  const issuerByOwner = new Map<string, StandalonePackageNode>();
  for (const node of nodesByRoot.values()) {
    const owner = packageOwnerNodeModules(node.root, node.name, `Runtime package ${node.name}`);
    const existing = issuerByOwner.get(owner);
    if (existing && existing.key !== node.key) {
      throw new Error(`Runtime pnpm owner contains multiple physical package roots: ${owner}.`);
    }
    issuerByOwner.set(owner, node);
  }

  const rootRequirements = new Map<string, StandalonePackageNode>();
  const externalRequirements = new Map<string, Map<string, StandalonePackageNode>>();
  const externalOwners = new Set<string>();
  for (const record of records) {
    const publicLink = path.join(rootNodeModules, ...record.node.name.split("/"));
    if (path.resolve(record.linkPath) === path.resolve(publicLink)) {
      setStandaloneRequirement(rootRequirements, record.node, "Runtime root");
      continue;
    }
    const issuer = issuerByOwner.get(record.ownerNodeModules);
    if (issuer) {
      setStandaloneRequirement(issuer.dependencies, record.node, `Runtime package ${issuer.name}`);
      continue;
    }
    if (!isInside(rootNodeModules, record.ownerNodeModules)) {
      externalOwners.add(record.ownerNodeModules);
      let requirements = externalRequirements.get(record.ownerNodeModules);
      if (!requirements) {
        requirements = new Map();
        externalRequirements.set(record.ownerNodeModules, requirements);
      }
      setStandaloneRequirement(
        requirements,
        record.node,
        `Runtime owner ${record.ownerNodeModules}`,
      );
      continue;
    }
    const relativeOwner = path.relative(rootNodeModules, record.ownerNodeModules);
    if (relativeOwner !== path.join(".pnpm", "node_modules")) {
      throw new Error(`Runtime dependency link has no package issuer: ${record.linkPath}.`);
    }
  }

  const nodesByName = new Map<string, StandalonePackageNode[]>();
  for (const node of nodesByRoot.values()) {
    const candidates = nodesByName.get(node.name) ?? [];
    candidates.push(node);
    nodesByName.set(node.name, candidates);
  }
  const rootChoices = new Map<string, StandalonePackageNode>();
  for (const [name, candidates] of nodesByName) {
    const required = rootRequirements.get(name);
    const selected =
      required ??
      [...candidates].sort(
        (left, right) =>
          right.referenceCount - left.referenceCount ||
          left.version.localeCompare(right.version) ||
          left.key.localeCompare(right.key),
      )[0];
    if (!selected) throw new Error(`Runtime package ${name} has no standalone candidate.`);
    rootChoices.set(name, selected);
  }

  const stagingRoot = path.join(artifactRoot, ".standalone-runtime");
  const stagedNodeModules = path.join(stagingRoot, "node_modules");
  await rm(stagingRoot, { force: true, recursive: true });
  await mkdir(stagedNodeModules, { recursive: true });
  const placements = new Map<string, string>();
  const hydrated = new Set<string>();
  const sortedRootChoices = [...rootChoices.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const node of sortedRootChoices) {
    await copyStandalonePackage(
      node,
      path.join(stagedNodeModules, ...node.name.split("/")),
      artifactRoot,
      placements,
    );
  }
  for (const node of sortedRootChoices) {
    await materializeStandaloneDependencies(
      node,
      path.join(stagedNodeModules, ...node.name.split("/")),
      rootChoices,
      artifactRoot,
      placements,
      hydrated,
    );
  }

  const stagedExternalOwners: { readonly owner: string; readonly staging: string }[] = [];
  const sortedExternalOwners = [...externalOwners].sort();
  for (const [index, owner] of sortedExternalOwners.entries()) {
    const requirements = externalRequirements.get(owner) ?? new Map();
    const localRequirements = [...requirements.values()]
      .filter((dependency) => rootChoices.get(dependency.name)?.key !== dependency.key)
      .sort((left, right) => left.name.localeCompare(right.name));
    if (localRequirements.length === 0) continue;
    const staging = path.join(stagingRoot, "external", String(index), "node_modules");
    await mkdir(staging, { recursive: true });
    const locallyAvailable = new Map(rootChoices);
    for (const dependency of localRequirements) {
      await copyStandalonePackage(
        dependency,
        path.join(staging, ...dependency.name.split("/")),
        artifactRoot,
        placements,
      );
      locallyAvailable.set(dependency.name, dependency);
    }
    for (const dependency of localRequirements) {
      await materializeStandaloneDependencies(
        dependency,
        path.join(staging, ...dependency.name.split("/")),
        locallyAvailable,
        artifactRoot,
        placements,
        hydrated,
      );
    }
    stagedExternalOwners.push({ owner, staging });
  }

  for (const owner of sortedExternalOwners) {
    await rm(owner, { force: true, recursive: true });
  }
  await rm(rootNodeModules, { force: true, recursive: true });
  await rename(stagedNodeModules, rootNodeModules);
  for (const { owner, staging } of stagedExternalOwners) {
    await mkdir(path.dirname(owner), { recursive: true });
    await rename(staging, owner);
  }
  await rm(stagingRoot, { force: true, recursive: true });
}

export function createRuntimeArtifactManifest(
  target: RuntimeArtifactTarget,
  externalPackages: readonly string[],
  nativeInventory: { readonly path: string; readonly size: number; readonly sha256: string },
  nativePackages: readonly string[] = RUNTIME_ARTIFACT_NATIVE_PACKAGES,
  resources: readonly string[] = [],
  links: readonly { readonly path: string; readonly target: string }[] = [],
  modelReadableResources: readonly string[] = [],
): RuntimeArtifactManifest {
  return assertRuntimeArtifactManifest({
    schemaVersion: RUNTIME_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifactKind: "workbench-runtime-node",
    runtimeMode: "api-only",
    controlVersion: RUNTIME_HOST_CONTROL_VERSION,
    hostProtocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
    target,
    entrypoint: RUNTIME_ARTIFACT_ENTRYPOINT,
    externalPackages,
    dynamicPackages: RUNTIME_ARTIFACT_DYNAMIC_PACKAGES,
    resources,
    modelReadableResources,
    nativePackages,
    nativeInventory,
    links,
    upgradeRequiredPaths: RUNTIME_ARTIFACT_UPGRADE_PATHS,
  });
}

/** Explicit capability used only by focused tests that publish beneath a temporary fixture root. */
export const TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT = Symbol(
  "TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT",
);

type RuntimeArtifactResolver = (
  options: ResolveRuntimeArtifactOptions,
) => Promise<ResolvedRuntimeArtifact>;

interface RuntimeArtifactPublishLockOwner {
  readonly schemaVersion: 1;
  readonly targetKey: string;
  readonly pid: number;
  readonly ownerId: string;
  readonly acquiredAt: string;
}

interface RuntimeArtifactPublishLock {
  readonly path: string;
  readonly identity: DirectoryIdentity;
  readonly owner: RuntimeArtifactPublishLockOwner;
}

class IncompleteRuntimeArtifactPublishLockError extends Error {}
class InvalidRuntimeArtifactPublishLockOwnerError extends Error {}

type ProcessAliveProbe = (pid: number) => boolean;
type BeforeOwnerClaimLink = (context: {
  readonly directory: string;
  readonly filename: string;
  readonly temporaryPath: string;
}) => void | Promise<void>;

const RUNTIME_ARTIFACT_PUBLISH_LOCK_OWNER_FILENAME = "owner.json";
const RUNTIME_ARTIFACT_PUBLISH_LOCK_INITIALIZATION_ATTEMPTS = 20;
const RUNTIME_ARTIFACT_PUBLISH_LOCK_RETRY_MILLISECONDS = 10;
const RUNTIME_ARTIFACT_PUBLISH_LOCK_WAIT_TIMEOUT_MILLISECONDS = 30 * 60 * 1_000;

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function assertUnchangedDirectory(
  directory: string,
  expected: DirectoryIdentity,
  label: string,
): Promise<void> {
  const actual = await directoryIdentity(directory, label);
  if (!sameDirectoryIdentity(actual, expected)) {
    throw new Error(`${label} changed during the Runtime artifact build.`);
  }
}

async function assertUnchangedFinalDirectory(
  finalDirectory: string,
  expected: DirectoryIdentity | undefined,
): Promise<void> {
  const actual = await optionalDirectoryIdentity(finalDirectory, "Runtime artifact final target");
  if (
    expected === undefined
      ? actual !== undefined
      : !actual || !sameDirectoryIdentity(actual, expected)
  ) {
    throw new Error("Runtime artifact final target changed during the build.");
  }
}

async function createUniqueOwnedDirectory(
  outputDirectory: string,
  prefix: string,
): Promise<Readonly<{ path: string; identity: DirectoryIdentity }>> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    // Native Windows build tools still impose legacy path limits. A short random token keeps the
    // transaction isolated without appending a PID and full UUID to deep pnpm package paths.
    const ownerToken = randomUUID().replaceAll("-", "").slice(0, 8);
    const directory = path.join(outputDirectory, `${prefix}-${ownerToken}`);
    try {
      await mkdir(directory);
      return Object.freeze({
        path: directory,
        identity: await directoryIdentity(directory, "Runtime artifact temporary target"),
      });
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error("Could not allocate a unique Runtime artifact temporary target.");
}

async function uniqueUnusedSiblingPath(outputDirectory: string, prefix: string): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = path.join(outputDirectory, `${prefix}-${process.pid}-${randomUUID()}`);
    try {
      await lstat(candidate);
    } catch (error: unknown) {
      if (isMissingPathError(error)) return candidate;
      throw error;
    }
  }
  throw new Error("Could not allocate a unique Runtime artifact backup target.");
}

async function removeOwnedDirectory(
  directory: string,
  expected: DirectoryIdentity,
  label: string,
): Promise<void> {
  const actual = await optionalDirectoryIdentity(directory, label);
  if (!actual) return;
  if (!sameDirectoryIdentity(actual, expected)) {
    throw new Error(`${label} is no longer owned by this build.`);
  }
  await rm(directory, { force: true, recursive: true });
}

function runtimeArtifactPublishBackupName(targetKey: string): string {
  return `.${targetKey}.backup`;
}

function runtimeArtifactPublishLockName(targetKey: string): string {
  return `.${targetKey}.publish-lock`;
}

function runtimeArtifactPublishLockRecoveryFilename(identity: DirectoryIdentity): string {
  return `recovery-owner-${identity.device.toString(16)}-${identity.inode.toString(16)}.json`;
}

function runtimeArtifactPublishLockRecoverySuccessorFilename(
  identity: DirectoryIdentity,
  generation: number,
  predecessorOwnerId: string,
): string {
  const predecessorHash = createHash("sha256")
    .update(predecessorOwnerId)
    .digest("hex")
    .slice(0, 16);
  return `recovery-owner-${identity.device.toString(16)}-${identity.inode.toString(16)}-${generation}-${predecessorHash}.json`;
}

function createRuntimeArtifactPublishLockOwner(targetKey: string): RuntimeArtifactPublishLockOwner {
  return Object.freeze({
    schemaVersion: 1,
    targetKey,
    pid: process.pid,
    ownerId: randomUUID(),
    acquiredAt: new Date().toISOString(),
  });
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

async function atomicallyPublishRuntimeArtifactLockOwner(
  directory: string,
  filename: string,
  owner: RuntimeArtifactPublishLockOwner,
  beforeLinkImpl?: BeforeOwnerClaimLink,
): Promise<boolean> {
  const temporaryPath = path.join(
    directory,
    `.${filename}.claim-${process.pid}-${randomUUID()}.tmp`,
  );
  const canonicalPath = path.join(directory, filename);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await beforeLinkImpl?.({ directory, filename, temporaryPath });
    try {
      await link(temporaryPath, canonicalPath);
      return true;
    } catch (error: unknown) {
      if (isAlreadyExistsError(error)) return false;
      throw error;
    }
  } finally {
    if (handle) await handle.close();
    try {
      await unlink(temporaryPath);
    } catch (error: unknown) {
      if (!isMissingPathError(error)) {
        // The owning lock directory is removed recursively on release/recovery.
      }
    }
  }
}

function assertRuntimeArtifactPublishLockOwner(
  value: unknown,
  targetKey: string,
  label: string,
): RuntimeArtifactPublishLockOwner {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object.`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expectedKeys = ["acquiredAt", "ownerId", "pid", "schemaVersion", "targetKey"];
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`${label} has unexpected fields.`);
  }
  if (
    record.schemaVersion !== 1 ||
    record.targetKey !== targetKey ||
    !Number.isSafeInteger(record.pid) ||
    (record.pid as number) <= 0 ||
    typeof record.ownerId !== "string" ||
    record.ownerId.length === 0 ||
    record.ownerId.length > 128 ||
    typeof record.acquiredAt !== "string" ||
    !Number.isFinite(Date.parse(record.acquiredAt))
  ) {
    throw new Error(`${label} is invalid for target ${targetKey}.`);
  }
  return Object.freeze({
    schemaVersion: 1,
    targetKey,
    pid: record.pid as number,
    ownerId: record.ownerId,
    acquiredAt: record.acquiredAt,
  });
}

function currentProcessIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error) {
      if (error.code === "ESRCH") return false;
      if (error.code === "EPERM") return true;
    }
    throw error;
  }
}

function waitForPublishLockRetry(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, RUNTIME_ARTIFACT_PUBLISH_LOCK_RETRY_MILLISECONDS);
  });
}

async function readInitializedPublishLockOwner(
  lockPath: string,
  expectedLockIdentity: DirectoryIdentity,
  filename: string,
  targetKey: string,
  label: string,
): Promise<RuntimeArtifactPublishLockOwner | undefined> {
  let lastError: unknown;
  let ownerFileWasAlwaysMissing = true;
  for (
    let attempt = 0;
    attempt < RUNTIME_ARTIFACT_PUBLISH_LOCK_INITIALIZATION_ATTEMPTS;
    attempt += 1
  ) {
    const actualIdentity = await optionalDirectoryIdentity(lockPath, label);
    if (!actualIdentity || !sameDirectoryIdentity(actualIdentity, expectedLockIdentity)) {
      return undefined;
    }
    try {
      return assertRuntimeArtifactPublishLockOwner(
        JSON.parse(await readFile(path.join(lockPath, filename), "utf8")),
        targetKey,
        label,
      );
    } catch (error: unknown) {
      lastError = error;
      if (!isMissingPathError(error)) ownerFileWasAlwaysMissing = false;
      await waitForPublishLockRetry();
    }
  }
  if (ownerFileWasAlwaysMissing) {
    throw new IncompleteRuntimeArtifactPublishLockError(
      `${label} has no owner after its bounded initialization grace period.`,
      { cause: lastError },
    );
  }
  throw new InvalidRuntimeArtifactPublishLockOwnerError(
    `${label} is incomplete or invalid; refusing to steal an ambiguous Runtime artifact publish lock. Confirm that no Runtime artifact publisher is running, then remove ${lockPath} manually.`,
    { cause: lastError },
  );
}

async function tryCreateRuntimeArtifactPublishLock(
  lockPath: string,
  targetKey: string,
  beforeOwnerClaimLinkImpl?: BeforeOwnerClaimLink,
): Promise<RuntimeArtifactPublishLock | undefined> {
  try {
    await mkdir(lockPath, { mode: 0o700 });
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") return undefined;
    throw error;
  }

  const identity = await directoryIdentity(lockPath, "Runtime artifact publish lock");
  const owner = createRuntimeArtifactPublishLockOwner(targetKey);
  try {
    if (
      !(await atomicallyPublishRuntimeArtifactLockOwner(
        lockPath,
        RUNTIME_ARTIFACT_PUBLISH_LOCK_OWNER_FILENAME,
        owner,
        beforeOwnerClaimLinkImpl,
      ))
    ) {
      return undefined;
    }
  } catch (error: unknown) {
    const cleanupErrors: unknown[] = [];
    try {
      await removeOwnedDirectory(lockPath, identity, "Runtime artifact publish lock");
    } catch (cleanupError: unknown) {
      cleanupErrors.push(cleanupError);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Runtime artifact publish lock initialization failed and cleanup was incomplete.",
      );
    }
    throw error;
  }
  return Object.freeze({ path: lockPath, identity, owner });
}

async function tryClaimIncompleteRuntimeArtifactPublishLock(
  lockPath: string,
  observedIdentity: DirectoryIdentity,
  targetKey: string,
  beforeOwnerClaimLinkImpl?: BeforeOwnerClaimLink,
): Promise<RuntimeArtifactPublishLock | undefined> {
  const owner = createRuntimeArtifactPublishLockOwner(targetKey);
  try {
    if (
      !(await atomicallyPublishRuntimeArtifactLockOwner(
        lockPath,
        RUNTIME_ARTIFACT_PUBLISH_LOCK_OWNER_FILENAME,
        owner,
        beforeOwnerClaimLinkImpl,
      ))
    ) {
      return undefined;
    }
  } catch (error: unknown) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
  await assertUnchangedDirectory(
    lockPath,
    observedIdentity,
    "Recovered incomplete Runtime artifact publish lock",
  );
  const claimedOwner = await readInitializedPublishLockOwner(
    lockPath,
    observedIdentity,
    RUNTIME_ARTIFACT_PUBLISH_LOCK_OWNER_FILENAME,
    targetKey,
    "Recovered incomplete Runtime artifact publish lock owner",
  );
  if (!claimedOwner || claimedOwner.ownerId !== owner.ownerId) {
    throw new Error("Incomplete Runtime artifact publish lock ownership changed after recovery.");
  }
  return Object.freeze({ path: lockPath, identity: observedIdentity, owner });
}

async function tryAcquireRuntimeArtifactPublishRecoveryClaim(
  lockPath: string,
  observedIdentity: DirectoryIdentity,
  targetKey: string,
  initialFilename: string,
  processIsAliveImpl: ProcessAliveProbe,
  beforeOwnerClaimLinkImpl?: BeforeOwnerClaimLink,
): Promise<Readonly<{ path: string; owner: RuntimeArtifactPublishLockOwner }> | undefined> {
  let recoveryFilename = initialFilename;
  for (let generation = 0; generation < 64; generation += 1) {
    const proposedOwner = createRuntimeArtifactPublishLockOwner(targetKey);
    try {
      if (
        await atomicallyPublishRuntimeArtifactLockOwner(
          lockPath,
          recoveryFilename,
          proposedOwner,
          beforeOwnerClaimLinkImpl,
        )
      ) {
        return Object.freeze({
          path: path.join(lockPath, recoveryFilename),
          owner: proposedOwner,
        });
      }
    } catch (error: unknown) {
      if (isMissingPathError(error)) return undefined;
      throw error;
    }

    let existingRecoveryOwner: RuntimeArtifactPublishLockOwner | undefined;
    try {
      existingRecoveryOwner = await readInitializedPublishLockOwner(
        lockPath,
        observedIdentity,
        recoveryFilename,
        targetKey,
        "Runtime artifact publish lock recovery owner",
      );
    } catch (error: unknown) {
      if (error instanceof IncompleteRuntimeArtifactPublishLockError) return undefined;
      throw error;
    }
    if (!existingRecoveryOwner) return undefined;
    if (processIsAliveImpl(existingRecoveryOwner.pid)) return undefined;
    recoveryFilename = runtimeArtifactPublishLockRecoverySuccessorFilename(
      observedIdentity,
      generation + 1,
      existingRecoveryOwner.ownerId,
    );
  }
  throw new Error("Runtime artifact publish lock recovery chain exceeds its safety limit.");
}

async function tryReclaimStaleRuntimeArtifactPublishLock(
  lockPath: string,
  observedIdentity: DirectoryIdentity,
  observedOwner: RuntimeArtifactPublishLockOwner,
  outputDirectory: string,
  targetKey: string,
  processIsAliveImpl: ProcessAliveProbe,
  beforeOwnerClaimLinkImpl?: BeforeOwnerClaimLink,
): Promise<boolean> {
  const recoveryClaim = await tryAcquireRuntimeArtifactPublishRecoveryClaim(
    lockPath,
    observedIdentity,
    targetKey,
    runtimeArtifactPublishLockRecoveryFilename(observedIdentity),
    processIsAliveImpl,
    beforeOwnerClaimLinkImpl,
  );
  if (!recoveryClaim) return false;
  const { path: recoveryPath, owner: recoveryOwner } = recoveryClaim;

  let quarantinePath: string | undefined;
  let quarantined = false;
  try {
    const claimedIdentity = await optionalDirectoryIdentity(
      lockPath,
      "Runtime artifact publish lock",
    );
    if (!claimedIdentity || !sameDirectoryIdentity(claimedIdentity, observedIdentity)) return false;
    const currentOwner = await readInitializedPublishLockOwner(
      lockPath,
      observedIdentity,
      RUNTIME_ARTIFACT_PUBLISH_LOCK_OWNER_FILENAME,
      targetKey,
      "Runtime artifact publish lock owner",
    );
    if (!currentOwner || currentOwner.ownerId !== observedOwner.ownerId) return false;
    if (processIsAliveImpl(currentOwner.pid)) return false;

    const currentRecoveryOwner = await readInitializedPublishLockOwner(
      lockPath,
      observedIdentity,
      path.basename(recoveryPath),
      targetKey,
      "Runtime artifact publish lock recovery owner",
    );
    if (
      !currentRecoveryOwner ||
      currentRecoveryOwner.ownerId !== recoveryOwner.ownerId ||
      currentRecoveryOwner.pid !== recoveryOwner.pid
    ) {
      return false;
    }

    quarantinePath = await uniqueUnusedSiblingPath(
      outputDirectory,
      `.${targetKey}.stale-publish-lock`,
    );
    await rename(lockPath, quarantinePath);
    quarantined = true;
    await assertUnchangedDirectory(
      quarantinePath,
      observedIdentity,
      "Stale Runtime artifact publish lock",
    );
    await removeOwnedDirectory(
      quarantinePath,
      observedIdentity,
      "Stale Runtime artifact publish lock",
    );
    return true;
  } finally {
    if (!quarantined) {
      const actualIdentity = await optionalDirectoryIdentity(
        lockPath,
        "Runtime artifact publish lock",
      );
      if (actualIdentity && sameDirectoryIdentity(actualIdentity, observedIdentity)) {
        await rm(recoveryPath, { force: true });
      }
    }
  }
}

async function acquireRuntimeArtifactPublishLock(
  outputDirectory: string,
  targetKey: string,
  processIsAliveImpl: ProcessAliveProbe,
  beforeOwnerClaimLinkImpl?: BeforeOwnerClaimLink,
): Promise<RuntimeArtifactPublishLock> {
  const lockPath = path.join(outputDirectory, runtimeArtifactPublishLockName(targetKey));
  const waitDeadline = Date.now() + RUNTIME_ARTIFACT_PUBLISH_LOCK_WAIT_TIMEOUT_MILLISECONDS;
  for (;;) {
    const created = await tryCreateRuntimeArtifactPublishLock(
      lockPath,
      targetKey,
      beforeOwnerClaimLinkImpl,
    );
    if (created) return created;

    const observedIdentity = await optionalDirectoryIdentity(
      lockPath,
      "Runtime artifact publish lock",
    );
    if (!observedIdentity) continue;
    let observedOwner: RuntimeArtifactPublishLockOwner | undefined;
    try {
      observedOwner = await readInitializedPublishLockOwner(
        lockPath,
        observedIdentity,
        RUNTIME_ARTIFACT_PUBLISH_LOCK_OWNER_FILENAME,
        targetKey,
        "Runtime artifact publish lock owner",
      );
    } catch (error: unknown) {
      if (!(error instanceof IncompleteRuntimeArtifactPublishLockError)) throw error;
      const claimed = await tryClaimIncompleteRuntimeArtifactPublishLock(
        lockPath,
        observedIdentity,
        targetKey,
        beforeOwnerClaimLinkImpl,
      );
      if (claimed) return claimed;
      continue;
    }
    if (!observedOwner) continue;
    if (processIsAliveImpl(observedOwner.pid)) {
      if (Date.now() >= waitDeadline) {
        throw new Error(
          `Timed out waiting for the live Runtime artifact publish lock for ${targetKey}; the lock was not stolen.`,
        );
      }
      await waitForPublishLockRetry();
      continue;
    }
    if (
      await tryReclaimStaleRuntimeArtifactPublishLock(
        lockPath,
        observedIdentity,
        observedOwner,
        outputDirectory,
        targetKey,
        processIsAliveImpl,
        beforeOwnerClaimLinkImpl,
      )
    ) {
      continue;
    }
    if (Date.now() >= waitDeadline) {
      throw new Error(
        `Timed out waiting to recover the Runtime artifact publish lock for ${targetKey}.`,
      );
    }
    await waitForPublishLockRetry();
  }
}

async function releaseRuntimeArtifactPublishLock(lock: RuntimeArtifactPublishLock): Promise<void> {
  await assertUnchangedDirectory(lock.path, lock.identity, "Runtime artifact publish lock");
  const owner = await readInitializedPublishLockOwner(
    lock.path,
    lock.identity,
    RUNTIME_ARTIFACT_PUBLISH_LOCK_OWNER_FILENAME,
    lock.owner.targetKey,
    "Runtime artifact publish lock owner",
  );
  if (!owner || owner.ownerId !== lock.owner.ownerId || owner.pid !== lock.owner.pid) {
    throw new Error("Runtime artifact publish lock ownership changed before release.");
  }
  await removeOwnedDirectory(lock.path, lock.identity, "Runtime artifact publish lock");
}

async function withRuntimeArtifactPublishLock<T>(
  outputDirectory: string,
  targetKey: string,
  processIsAliveImpl: ProcessAliveProbe,
  beforeOwnerClaimLinkImpl: BeforeOwnerClaimLink | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = await acquireRuntimeArtifactPublishLock(
    outputDirectory,
    targetKey,
    processIsAliveImpl,
    beforeOwnerClaimLinkImpl,
  );
  let result: T | undefined;
  let operationFailed = false;
  let operationError: unknown;
  try {
    result = await operation();
  } catch (error: unknown) {
    operationFailed = true;
    operationError = error;
  }
  try {
    await releaseRuntimeArtifactPublishLock(lock);
  } catch (releaseError: unknown) {
    if (operationFailed) {
      throw new AggregateError(
        [operationError, releaseError],
        "Runtime artifact publish failed and its exclusive lock could not be released.",
      );
    }
    throw new Error(
      "Runtime artifact was published, but its exclusive lock could not be released.",
      { cause: releaseError },
    );
  }
  if (operationFailed) throw operationError;
  return result as T;
}

async function recoverInterruptedRuntimeArtifactPublish(
  outputDirectory: string,
  targetKey: string,
  finalDirectory: string,
  admit: (directory: string) => Promise<ResolvedRuntimeArtifact>,
): Promise<DirectoryIdentity | undefined> {
  const finalIdentity = await optionalDirectoryIdentity(
    finalDirectory,
    "Runtime artifact final target",
  );
  const backupName = runtimeArtifactPublishBackupName(targetKey);
  const backupCandidates = (await readdir(outputDirectory))
    .filter((entry) => entry === backupName || entry.startsWith(`${backupName}-`))
    .sort();
  if (backupCandidates.length === 0) return finalIdentity;
  if (backupCandidates.length > 1) {
    throw new Error(
      `Runtime artifact publish recovery is ambiguous: multiple backup candidates exist for ${targetKey}.`,
    );
  }

  const backupPath = path.join(outputDirectory, backupCandidates[0]);
  const backupIdentity = await directoryIdentity(
    backupPath,
    "Runtime artifact publish recovery backup",
  );
  if (finalIdentity) {
    if (backupCandidates[0] !== backupName) {
      throw new Error(
        `Runtime artifact publish recovery is ambiguous: both final and a legacy backup target exist for ${targetKey}.`,
      );
    }

    let finalAdmission: ResolvedRuntimeArtifact | undefined;
    let finalAdmissionError: unknown;
    try {
      finalAdmission = await admit(finalDirectory);
    } catch (error: unknown) {
      finalAdmissionError = error;
    }
    let backupAdmission: ResolvedRuntimeArtifact | undefined;
    let backupAdmissionError: unknown;
    try {
      backupAdmission = await admit(backupPath);
    } catch (error: unknown) {
      backupAdmissionError = error;
    }

    await assertUnchangedDirectory(
      finalDirectory,
      finalIdentity,
      "Interrupted Runtime artifact final target",
    );
    await assertUnchangedDirectory(
      backupPath,
      backupIdentity,
      "Interrupted Runtime artifact backup target",
    );
    if (finalAdmission) {
      await removeOwnedDirectory(
        backupPath,
        backupIdentity,
        "Committed Runtime artifact prior-generation backup",
      );
      return finalIdentity;
    }
    if (!backupAdmission) {
      throw new AggregateError(
        [finalAdmissionError, backupAdmissionError],
        `Neither interrupted Runtime artifact generation is admissible for ${targetKey}.`,
      );
    }

    const rejectedFinalPath = await uniqueUnusedSiblingPath(
      outputDirectory,
      `.${targetKey}.rejected-final`,
    );
    let rejectedFinalAtPath = false;
    let backupAtFinal = false;
    let recoveredCommitted = false;
    try {
      await rename(finalDirectory, rejectedFinalPath);
      rejectedFinalAtPath = true;
      await rename(backupPath, finalDirectory);
      backupAtFinal = true;
      await assertUnchangedDirectory(
        finalDirectory,
        backupIdentity,
        "Restored Runtime artifact final target",
      );
      await admit(finalDirectory);
      await assertUnchangedDirectory(
        finalDirectory,
        backupIdentity,
        "Admitted restored Runtime artifact final target",
      );
      await assertUnchangedDirectory(
        rejectedFinalPath,
        finalIdentity,
        "Rejected interrupted Runtime artifact final target",
      );
      recoveredCommitted = true;
      await removeOwnedDirectory(
        rejectedFinalPath,
        finalIdentity,
        "Rejected interrupted Runtime artifact final target",
      );
      rejectedFinalAtPath = false;
      return backupIdentity;
    } catch (error: unknown) {
      if (recoveredCommitted) {
        throw new Error(
          "Runtime artifact prior generation was restored and admitted, but the rejected generation could not be cleaned.",
          { cause: error },
        );
      }
      const rollbackErrors: unknown[] = [];
      if (backupAtFinal) {
        try {
          await assertUnchangedDirectory(
            finalDirectory,
            backupIdentity,
            "Restored Runtime artifact final target",
          );
          await rename(finalDirectory, backupPath);
          backupAtFinal = false;
        } catch (rollbackError: unknown) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rejectedFinalAtPath) {
        try {
          await assertUnchangedDirectory(
            rejectedFinalPath,
            finalIdentity,
            "Rejected interrupted Runtime artifact final target",
          );
          await rename(rejectedFinalPath, finalDirectory);
          rejectedFinalAtPath = false;
        } catch (rollbackError: unknown) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          "Runtime artifact generation recovery failed and rollback was incomplete.",
        );
      }
      throw error;
    }
  }

  await admit(backupPath);
  await assertUnchangedDirectory(
    backupPath,
    backupIdentity,
    "Admitted Runtime artifact publish recovery backup",
  );
  let restoredAtFinal = false;
  try {
    await rename(backupPath, finalDirectory);
    restoredAtFinal = true;
    await assertUnchangedDirectory(
      finalDirectory,
      backupIdentity,
      "Recovered Runtime artifact final target",
    );
    await admit(finalDirectory);
    await assertUnchangedDirectory(
      finalDirectory,
      backupIdentity,
      "Admitted recovered Runtime artifact final target",
    );
    return backupIdentity;
  } catch (error: unknown) {
    if (restoredAtFinal) {
      try {
        await assertUnchangedDirectory(
          finalDirectory,
          backupIdentity,
          "Recovered Runtime artifact final target",
        );
        await rename(finalDirectory, backupPath);
      } catch (rollbackError: unknown) {
        throw new AggregateError(
          [error, rollbackError],
          "Runtime artifact publish recovery failed and rollback was incomplete.",
        );
      }
    }
    throw error;
  }
}

async function runtimeArtifactOutputAuthority({
  repositoryRoot,
  outputDirectory,
  testOnlyOutputPolicy,
}: {
  readonly repositoryRoot: string;
  readonly outputDirectory: string;
  readonly testOnlyOutputPolicy?: typeof TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT;
}): Promise<Readonly<{ outputIdentity: DirectoryIdentity }>> {
  canonicalPathSpelling(repositoryRoot, "Runtime artifact repository root");
  canonicalPathSpelling(outputDirectory, "Runtime artifact output root");
  await directoryIdentity(repositoryRoot, "Runtime artifact repository root");

  const isTestOutput = testOnlyOutputPolicy === TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT;
  if (!isTestOutput) {
    if (repositoryRoot !== REPOSITORY_ROOT) {
      throw new Error("Runtime artifact repository owner must be the canonical repository root.");
    }
    const expectedOutputDirectory = path.join(repositoryRoot, ".desktop-build", "runtime-node");
    if (outputDirectory !== expectedOutputDirectory) {
      throw new Error(`Runtime artifact output owner must be exactly ${expectedOutputDirectory}.`);
    }
    const desktopBuildDirectory = path.dirname(outputDirectory);
    const desktopBuildIdentity = await optionalDirectoryIdentity(
      desktopBuildDirectory,
      "Runtime artifact build root",
    );
    if (!desktopBuildIdentity) await mkdir(desktopBuildDirectory, { recursive: true });
    if (!(await optionalDirectoryIdentity(outputDirectory, "Runtime artifact output root"))) {
      await mkdir(outputDirectory, { recursive: true });
    }
  }

  return Object.freeze({
    outputIdentity: await directoryIdentity(outputDirectory, "Runtime artifact output root"),
  });
}

export interface PublishRuntimeArtifactTransactionOptions {
  readonly target: RuntimeArtifactTarget;
  readonly repositoryRoot?: string;
  readonly outputDirectory?: string;
  readonly policy?: RuntimeArtifactAdmissionPolicy;
  readonly resolveArtifactImpl?: RuntimeArtifactResolver;
  readonly testOnlyOutputPolicy?: typeof TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT;
  readonly testOnlyRemoveOwnedDirectoryImpl?: typeof removeOwnedDirectory;
  readonly testOnlyProcessIsAliveImpl?: ProcessAliveProbe;
  readonly testOnlyBeforeOwnerClaimLinkImpl?: BeforeOwnerClaimLink;
  readonly buildTemporaryArtifact: (temporaryDirectory: string) => Promise<void>;
}

/** Builds and validates an immutable candidate before swapping it into the sole target location. */
export async function publishRuntimeArtifactTransaction({
  target,
  repositoryRoot = REPOSITORY_ROOT,
  outputDirectory = DEFAULT_RUNTIME_ARTIFACT_DIRECTORY,
  policy = runtimeArtifactAdmissionPolicy,
  resolveArtifactImpl = resolveRuntimeArtifact,
  testOnlyOutputPolicy,
  testOnlyRemoveOwnedDirectoryImpl,
  testOnlyProcessIsAliveImpl,
  testOnlyBeforeOwnerClaimLinkImpl,
  buildTemporaryArtifact,
}: PublishRuntimeArtifactTransactionOptions): Promise<RuntimeArtifactManifest> {
  const usesTestCapability =
    testOnlyOutputPolicy === TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT;
  if (
    !usesTestCapability &&
    (policy !== runtimeArtifactAdmissionPolicy ||
      resolveArtifactImpl !== resolveRuntimeArtifact ||
      testOnlyRemoveOwnedDirectoryImpl !== undefined ||
      testOnlyProcessIsAliveImpl !== undefined ||
      testOnlyBeforeOwnerClaimLinkImpl !== undefined)
  ) {
    throw new Error("Runtime artifact test overrides require the explicit test-only capability.");
  }
  const removeOwnedDirectoryImpl = testOnlyRemoveOwnedDirectoryImpl ?? removeOwnedDirectory;
  const processIsAliveImpl = testOnlyProcessIsAliveImpl ?? currentProcessIsAlive;
  const authority = await runtimeArtifactOutputAuthority({
    repositoryRoot,
    outputDirectory,
    testOnlyOutputPolicy,
  });
  const targetKey = runtimeArtifactTargetKey(target);
  const finalDirectory = path.join(outputDirectory, targetKey);

  const manifestPath = (directory: string) =>
    path.join(directory, RUNTIME_ARTIFACT_MANIFEST_FILENAME);
  const admit = (directory: string) =>
    resolveArtifactImpl({
      manifestPath: manifestPath(directory),
      policy,
      expectedTarget: target,
    });

  return withRuntimeArtifactPublishLock(
    outputDirectory,
    targetKey,
    processIsAliveImpl,
    testOnlyBeforeOwnerClaimLinkImpl,
    async () => {
      await assertUnchangedDirectory(
        outputDirectory,
        authority.outputIdentity,
        "Runtime artifact output root",
      );
      const initialFinalIdentity = await recoverInterruptedRuntimeArtifactPublish(
        outputDirectory,
        targetKey,
        finalDirectory,
        admit,
      );
      const targetToken = createHash("sha256").update(targetKey).digest("hex").slice(0, 8);
      const temporary = await createUniqueOwnedDirectory(
        outputDirectory,
        `.t-${targetToken}-${process.pid}`,
      );
      let temporaryAtPath = true;
      let publishedAtFinal = false;
      const backupPath = path.join(outputDirectory, runtimeArtifactPublishBackupName(targetKey));
      let backupAtPath = false;
      let committed = false;

      try {
        await buildTemporaryArtifact(temporary.path);
        await assertUnchangedDirectory(
          temporary.path,
          temporary.identity,
          "Built Runtime artifact temporary target",
        );
        await admit(temporary.path);
        await assertUnchangedDirectory(
          temporary.path,
          temporary.identity,
          "Admitted Runtime artifact temporary target",
        );

        await assertUnchangedDirectory(
          outputDirectory,
          authority.outputIdentity,
          "Runtime artifact output root",
        );
        await assertUnchangedFinalDirectory(finalDirectory, initialFinalIdentity);

        if (initialFinalIdentity) {
          await rename(finalDirectory, backupPath);
          backupAtPath = true;
          await assertUnchangedDirectory(
            backupPath,
            initialFinalIdentity,
            "Runtime artifact backup target",
          );
        }

        await assertUnchangedDirectory(
          temporary.path,
          temporary.identity,
          "Pre-publish Runtime artifact temporary target",
        );
        await rename(temporary.path, finalDirectory);
        temporaryAtPath = false;
        publishedAtFinal = true;
        await assertUnchangedDirectory(
          finalDirectory,
          temporary.identity,
          "Published Runtime artifact target",
        );
        const resolved = await admit(finalDirectory);
        await assertUnchangedDirectory(
          finalDirectory,
          temporary.identity,
          "Admitted published Runtime artifact target",
        );
        if (initialFinalIdentity) {
          await assertUnchangedDirectory(
            backupPath,
            initialFinalIdentity,
            "Admitted Runtime artifact backup target",
          );
        }
        committed = true;

        if (initialFinalIdentity) {
          await removeOwnedDirectoryImpl(
            backupPath,
            initialFinalIdentity,
            "Runtime artifact backup target",
          );
          backupAtPath = false;
        }
        return resolved.manifest;
      } catch (error: unknown) {
        if (committed) {
          throw new Error(
            "Runtime artifact was published and admitted, but its old backup could not be cleaned.",
            { cause: error },
          );
        }
        const rollbackErrors: unknown[] = [];
        if (publishedAtFinal) {
          try {
            await assertUnchangedDirectory(
              finalDirectory,
              temporary.identity,
              "Published Runtime artifact target",
            );
            await rename(finalDirectory, temporary.path);
            publishedAtFinal = false;
            temporaryAtPath = true;
          } catch (rollbackError: unknown) {
            rollbackErrors.push(rollbackError);
          }
        }
        if (backupAtPath && initialFinalIdentity) {
          try {
            await assertUnchangedDirectory(
              backupPath,
              initialFinalIdentity,
              "Runtime artifact backup target",
            );
            await rename(backupPath, finalDirectory);
            backupAtPath = false;
          } catch (rollbackError: unknown) {
            rollbackErrors.push(rollbackError);
          }
        }
        if (temporaryAtPath) {
          try {
            await removeOwnedDirectory(
              temporary.path,
              temporary.identity,
              "Runtime artifact temporary target",
            );
            temporaryAtPath = false;
          } catch (cleanupError: unknown) {
            rollbackErrors.push(cleanupError);
          }
        }
        if (rollbackErrors.length > 0) {
          throw new AggregateError(
            [error, ...rollbackErrors],
            "Runtime artifact publish failed and rollback was incomplete.",
          );
        }
        throw error;
      }
    },
  );
}

export interface BuildRuntimeArtifactOptions {
  readonly target?: RuntimeArtifactTarget;
  readonly targetAdapter?: RuntimeArtifactTargetAdapter;
  readonly appRoot?: string;
  readonly repositoryRoot?: string;
  /** Artifact root; the actual target artifact is always written below a target key. */
  readonly outputDirectory?: string;
  readonly buildImpl?: (
    options: BuildOptions,
  ) => Promise<BuildResult<BuildOptions> & { metafile: Metafile }>;
  readonly nodeFileTraceImpl?: NodeFileTrace;
  readonly resolveArtifactImpl?: RuntimeArtifactResolver;
  readonly testOnlyOutputPolicy?: typeof TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT;
}

export async function copyRuntimeBuiltinResources(
  repositoryRoot: string,
  outputDirectory: string,
): Promise<void> {
  // Workbench modules are bundled into server.mjs, so import.meta.url resolves at the artifact root.
  for (const relative of ["skills/builtin-skills", "internal-extensions"]) {
    await cp(
      path.join(repositoryRoot, "packages/agent-runtime/runtimes/pi/server/src", relative),
      path.join(outputDirectory, relative),
      { recursive: true },
    );
  }
}

export async function buildRuntimeArtifact({
  target: requestedTarget = currentNodeArtifactTarget(),
  targetAdapter,
  appRoot = RUNTIME_NODE_APP_ROOT,
  repositoryRoot = REPOSITORY_ROOT,
  outputDirectory = DEFAULT_RUNTIME_ARTIFACT_DIRECTORY,
  buildImpl = build as BuildRuntimeArtifactOptions["buildImpl"],
  nodeFileTraceImpl,
  resolveArtifactImpl,
  testOnlyOutputPolicy,
}: BuildRuntimeArtifactOptions = {}): Promise<RuntimeArtifactManifest> {
  const target = validateTargetWithContract(requestedTarget);
  const adapter =
    targetAdapter ??
    (target.runtimeFlavor === "node" ? currentNodeRuntimeArtifactAdapter : undefined);
  if (!adapter || adapter.runtimeFlavor !== target.runtimeFlavor)
    throw new Error(
      `Runtime artifact target ${target.runtimeFlavor} requires a matching materialization adapter.`,
    );
  await adapter.validateTarget(target);
  if (!buildImpl) throw new Error("Runtime artifact builder is unavailable.");

  return publishRuntimeArtifactTransaction({
    target,
    repositoryRoot,
    outputDirectory,
    resolveArtifactImpl,
    testOnlyOutputPolicy,
    buildTemporaryArtifact: async (temporaryDirectory) => {
      const result = await buildImpl(
        createRuntimeArtifactBuildOptions({ appRoot, outputDirectory: temporaryDirectory }),
      );
      assertRuntimeArtifactInputClosure(result.metafile, { appRoot, repositoryRoot });
      await assertRuntimeArtifactInputRealpathProvenance(result.metafile, {
        appRoot,
        repositoryRoot,
      });
      const externalPackages = assertRuntimeArtifactExternalPackages(
        externalPackagesFromMetafile(result.metafile),
      );

      const requireFromApp = createRequire(path.join(appRoot, "package.json"));
      const nft = requireFromApp("@vercel/nft") as {
        readonly nodeFileTrace: NodeFileTrace;
        readonly resolve: (
          specifier: string,
          parent: string,
          job: unknown,
          cjsResolve: boolean,
        ) => Promise<NodeFileTraceResolution>;
      };
      const trace = nodeFileTraceImpl ?? nft.nodeFileTrace;
      const resolve = await createRuntimeArtifactTraceResolver({
        appRoot,
        repositoryRoot,
        target,
        resolveDependency: nft.resolve,
      });
      const traceEntries = [
        path.join(temporaryDirectory, RUNTIME_ARTIFACT_ENTRYPOINT),
        ...(await runtimeTraceEntries(appRoot)),
      ];
      // Both branches are needed: Pi's published tree is ESM-first while several of its runtime
      // dependencies select CJS exports through require(). Their union remains an NFT exact closure.
      // Resolve runtime-relative user data (for example Anthropic skill downloads) from the isolated
      // candidate. Bundled resources are copied explicitly after dependency tracing.
      const traces = await Promise.all([
        trace(traceEntries, {
          base: repositoryRoot,
          conditions: ["node", "production", "import"],
          exportsOnly: true,
          ignore: path.isAbsolute,
          processCwd: temporaryDirectory,
          resolve,
        }),
        trace(traceEntries, {
          base: repositoryRoot,
          conditions: ["node", "production", "require"],
          exportsOnly: true,
          ignore: path.isAbsolute,
          processCwd: temporaryDirectory,
          resolve,
        }),
      ]);
      const unexpectedWarnings = traces
        .flatMap((traced) => [...traced.warnings])
        .filter((warning) => !isAllowedTraceWarning(warning));
      if (unexpectedWarnings.length > 0)
        throw new Error(
          `Runtime artifact dependency tracing produced unexpected warnings:\n${unexpectedWarnings.join("\n")}`,
        );

      const tracedFiles = [...new Set(traces.flatMap((traced) => [...traced.fileList]))].sort();
      const runtimeAppAliasSources = new Set(
        runtimeAppOwnedExternalTraceAliases({ appRoot, repositoryRoot }).map(
          (alias) => alias.sourceRelativePath,
        ),
      );
      for (const relativePath of tracedFiles) {
        const normalized = artifactRelativePath(relativePath);
        if (
          path.resolve(repositoryRoot, normalized) ===
          path.join(temporaryDirectory, RUNTIME_ARTIFACT_ENTRYPOINT)
        )
          continue;
        if (
          normalized.includes("/node_modules/next/") ||
          normalized.startsWith("node_modules/next/")
        )
          throw new Error("Runtime artifact trace included Next.js.");
        if (runtimeAppAliasSources.has(normalized)) continue;
        await copyRuntimeArtifactClosurePath(normalized, repositoryRoot, temporaryDirectory);
      }
      await projectRuntimeAppOwnedExternalTraceAliases({
        tracedPaths: tracedFiles,
        appRoot,
        repositoryRoot,
        outputDirectory: temporaryDirectory,
      });
      for (const packageName of RUNTIME_ARTIFACT_DYNAMIC_PACKAGES)
        await copyDynamicPackage(packageName, appRoot, repositoryRoot, temporaryDirectory);
      // The terminal package is the explicit owner of ABI-sensitive dependencies. Trace supplies the
      // dependency graph; this replaces just those owner packages with complete target material.
      for (const packageName of RUNTIME_ARTIFACT_NATIVE_PACKAGES)
        await copyOwnedPackage(packageName, appRoot, repositoryRoot, temporaryDirectory);
      await copyRuntimeBuiltinResources(repositoryRoot, temporaryDirectory);
      await projectTracedPnpmDependencyLinks({
        repositoryRoot,
        outputDirectory: temporaryDirectory,
      });
      await adapter.materialize?.({ target, outputDirectory: temporaryDirectory, repositoryRoot });
      // Inventory Pi documentation/examples and Workbench extension sources before pruning.
      // Workbench snapshots retain TS source; only Pi examples may retain test files.
      const prePruneModelReadable = await collectRuntimeModelReadableResources(temporaryDirectory);
      await pruneRuntimeTree(temporaryDirectory, temporaryDirectory, {
        modelReadableResources: prePruneModelReadable.resources,
        resolvedExamplesRoot: prePruneModelReadable.resolvedExamplesRoot,
      });
      await pruneKnownNativeVariants(temporaryDirectory, target, repositoryRoot);
      const sourceLinks = await finalArtifactLinks(temporaryDirectory);
      if (target.platform === "win32") {
        await flattenWindowsRuntimeNodeModules(temporaryDirectory, sourceLinks);
      }
      await assertArtifactConfinement(temporaryDirectory);
      await assertFinalArtifactPackageBoundary(temporaryDirectory);
      const measured = await writeNativeInventory(temporaryDirectory, target);
      const resources = await finalArtifactResources(temporaryDirectory);
      const links = await finalArtifactLinks(temporaryDirectory);
      if (target.platform === "win32" && links.length > 0) {
        throw new Error("Windows Runtime artifact must not contain symbolic links.");
      }
      const modelReadable = await collectRuntimeModelReadableResources(temporaryDirectory);
      assertRuntimeModelReadableResourceClassification({
        resources,
        modelReadableResources: modelReadable.resources,
        expectedModelReadableResources: modelReadable.resources,
        resolvedExamplesRoot: modelReadable.resolvedExamplesRoot,
      });
      const manifest = createRuntimeArtifactManifest(
        target,
        externalPackages,
        measured.reference,
        measured.nativePackages,
        resources,
        links,
        modelReadable.resources,
      );
      await writeFile(
        path.join(temporaryDirectory, RUNTIME_ARTIFACT_MANIFEST_FILENAME),
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      );
      if (target.platform !== "win32") {
        await normalizeRuntimeArtifactPermissions(temporaryDirectory);
      }
    },
  });
}

function configuredTarget(environment: NodeJS.ProcessEnv): RuntimeArtifactTarget {
  const encoded = environment.WORKBENCH_RUNTIME_ARTIFACT_TARGET_JSON?.trim();
  if (!encoded) return currentNodeArtifactTarget();
  try {
    return validateTargetWithContract(JSON.parse(encoded) as RuntimeArtifactTarget);
  } catch {
    throw new Error("Runtime artifact target configuration is invalid.");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const request = parseRuntimeArtifactBuildRequest(process.argv.slice(2));
  const target = request?.target ?? configuredTarget(process.env);
  void buildRuntimeArtifact({
    target,
    targetAdapter: request ? createCommandRuntimeArtifactTargetAdapter(request) : undefined,
    outputDirectory: request?.outputDirectory,
  })
    .then((manifest) =>
      console.log(
        `[runtime-node] Built ${manifest.entrypoint} for ${manifest.target.targetTriple}; external packages: ${manifest.externalPackages.join(", ")}.`,
      ),
    )
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Runtime artifact build failed.");
      process.exitCode = 1;
    });
}
