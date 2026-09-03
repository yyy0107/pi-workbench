import { createHash, randomUUID } from "node:crypto";
import {
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

import {
  WEB_ARTIFACT_EXTERNAL_PACKAGES,
  WEB_ARTIFACT_KIND,
  WEB_ARTIFACT_MANIFEST_FILENAME,
  WEB_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  WEB_ARTIFACT_PRIMARY_ENTRYPOINT,
  assertWebArtifactManifest,
  isWebArtifactRelativePath,
  normalizeWebArtifactRelativePath,
  webArtifactBuildIdPath,
  webArtifactRequiredServerFilesPath,
  type WebArtifactFile,
  type WebArtifactLink,
  type WebArtifactManifest,
} from "@workbench/host-contracts/web-artifact-manifest";
import { RUNTIME_HOST_PROTOCOL_VERSION } from "@workbench/host-contracts/runtime-host-control";
import {
  WEB_HOST_CONTROL_MAX_SHUTDOWN_DEADLINE_MS,
  WEB_HOST_CONTROL_TRANSPORT,
  WEB_HOST_CONTROL_VERSION,
  WEB_HOST_SHUTDOWN_ACK_FRAME_TYPE,
  WEB_HOST_SHUTDOWN_FRAME_TYPE,
} from "@workbench/host-contracts/web-host-control";
import {
  resolveWebArtifact,
  type ResolveWebArtifactOptions,
  type ResolvedWebArtifact,
} from "@workbench/host-server/web-artifact";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const WEB_APP_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
export const WEB_REPOSITORY_ROOT = path.resolve(WEB_APP_ROOT, "../..");
export const DEFAULT_WEB_ARTIFACT_DIRECTORY = path.join(
  WEB_REPOSITORY_ROOT,
  ".desktop-build",
  "web",
);
export const WEB_ARTIFACT_PRIMARY_SOURCE_ENTRY = path.join(
  WEB_APP_ROOT,
  "src",
  "server",
  "web-artifact-main.ts",
);
const WEB_ARTIFACT_EXTERNAL_SPECIFIERS = WEB_ARTIFACT_EXTERNAL_PACKAGES.flatMap((packageName) => [
  packageName,
  packageName + "/*",
]);
const WEB_ARTIFACT_ESM_BANNER =
  'import { createRequire as __workbenchCreateRequire } from "node:module";\n' +
  "const require = __workbenchCreateRequire(import.meta.url);";
const WEB_BUILD_ID_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,255}$/u;
const WEB_RUNTIME_OWNED_PACKAGES = new Set([
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "node-addon-api",
  "node-pty",
  "tree-sitter",
  "tree-sitter-bash",
]);
const FILE_VIEWER_PRESENTATION_ASSETS = Object.freeze([
  "vendor/ppt/index.mjs",
  "vendor/ppt/worker.mjs",
  "vendor/ppt/ppt-native.wasm",
  "vendor/ppt/ppt-font-cjk.otf",
  "vendor/pptx/pptx.worker.js",
]);

const repositoryRequire = createRequire(path.join(WEB_REPOSITORY_ROOT, "package.json"));
const webAppRequire = createRequire(import.meta.url);
const standaloneTools = webAppRequire("./complete-next-standalone-runtime.cjs") as {
  readonly completeNextStandaloneRuntime: (options: {
    readonly paths?: unknown;
    readonly standaloneRoot?: string;
  }) => unknown;
};
const pathTools = repositoryRequire("./scripts/workbench-paths.cjs") as {
  readonly createWorkbenchPaths: (options: { readonly repositoryRoot: string }) => unknown;
};
const sourceShapePolicy = webAppRequire("@workbench/host-artifact-policy/source-shape") as {
  readonly isArtifactTestDirectoryPath: (candidate: string) => boolean;
  readonly isArtifactTestShapedPath: (candidate: string) => boolean;
};
const nextRuntimeExceptionPolicy = webAppRequire(
  "@workbench/host-artifact-policy/web-next-runtime-exception",
) as {
  readonly assertWebArtifactNextRuntimeExceptionResource: (options: {
    readonly artifactRoot: string;
    readonly resources: readonly string[];
  }) => { readonly artifactRelativePath: string };
  readonly resolveWebArtifactNextRuntimeException: (options: { readonly artifactRoot: string }) => {
    readonly artifactRelativePath: string;
  };
  readonly assertWebArtifactNextWebpackRuntimeResources: (options: {
    readonly artifactRoot: string;
    readonly resources: readonly string[];
  }) => {
    readonly resources: readonly { readonly artifactRelativePath: string }[];
  };
  readonly resolveWebArtifactNextWebpackRuntime: (options: { readonly artifactRoot: string }) => {
    readonly resources: readonly { readonly artifactRelativePath: string }[];
  };
};

export interface WebArtifactBuildOptionsInput {
  readonly appRoot?: string;
  readonly entryPoint: string;
  readonly outputFile: string;
}

/** Shared esbuild seam for the sole primary Web control entry. */
export function createWebArtifactBuildOptions({
  appRoot = WEB_APP_ROOT,
  entryPoint,
  outputFile,
}: WebArtifactBuildOptionsInput): BuildOptions {
  return {
    absWorkingDir: appRoot,
    // Give esbuild's generated dynamic-require bridge a real ESM-scoped require for Node built-ins.
    banner: { js: WEB_ARTIFACT_ESM_BANNER },
    bundle: true,
    entryPoints: [entryPoint],
    external: WEB_ARTIFACT_EXTERNAL_SPECIFIERS,
    format: "esm",
    legalComments: "none",
    metafile: true,
    outfile: outputFile,
    platform: "node",
    sourcemap: false,
    target: "node22",
  };
}

function packageNameForSpecifier(specifier: string): string | undefined {
  if (isBuiltin(specifier)) return undefined;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

export function externalPackagesFromWebMetafile(metafile: Metafile): readonly string[] {
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

export function assertWebArtifactExternalPackages(metafile: Metafile): readonly string[] {
  const actual = externalPackagesFromWebMetafile(metafile);
  const workspacePackages = actual.filter((packageName) => packageName.startsWith("@workbench/"));
  if (workspacePackages.length > 0) {
    throw new Error(
      "Web artifact externalized a Workbench package: " + workspacePackages.join(", "),
    );
  }
  if (JSON.stringify(actual) !== JSON.stringify(WEB_ARTIFACT_EXTERNAL_PACKAGES)) {
    throw new Error(
      "Web artifact external package set changed: " +
        (actual.join(", ") || "none") +
        "; expected " +
        WEB_ARTIFACT_EXTERNAL_PACKAGES.join(", ") +
        ".",
    );
  }
  return actual;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function artifactRelativePath(value: string): string {
  const normalized = normalizeWebArtifactRelativePath(value);
  if (!normalized) {
    throw new Error("Unsafe Web artifact relative path: " + value + ".");
  }
  return normalized;
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await lstat(value);
    return true;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

async function requireDirectory(value: string, label: string): Promise<void> {
  const stats = await lstat(value);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(label + " must be a regular directory.");
  }
}

async function requireRegularFile(value: string, label: string): Promise<void> {
  const stats = await lstat(value);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(label + " must be a regular file.");
  }
}

function normalizedBuildId(value: string): string {
  const trimmed = value.trim();
  if (!WEB_BUILD_ID_PATTERN.test(trimmed)) throw new Error("Next BUILD_ID is invalid.");
  return trimmed;
}

export interface NextStandaloneMetadata {
  readonly relativeAppDir: string;
  readonly buildId: string;
  readonly config: Readonly<Record<string, unknown>>;
}

/**
 * Treats Next's required-server-files metadata as the sole relative-app authority. The source
 * path is bound to its canonical tracing root and appDir so callers cannot substitute a layout.
 */
export async function readNextStandaloneMetadata({
  repositoryRoot,
  webRoot,
  webBuildRoot,
}: {
  readonly repositoryRoot: string;
  readonly webRoot: string;
  readonly webBuildRoot: string;
}): Promise<NextStandaloneMetadata> {
  const metadataPath = path.join(webBuildRoot, "required-server-files.json");
  await requireRegularFile(metadataPath, "Next required-server-files.json");
  let metadata: unknown;
  try {
    metadata = JSON.parse(await readFile(metadataPath, "utf8")) as unknown;
  } catch {
    throw new Error("Next required-server-files.json is invalid JSON.");
  }
  const relativeAppDir = isRecord(metadata)
    ? normalizeWebArtifactRelativePath(metadata.relativeAppDir)
    : undefined;
  if (
    !isRecord(metadata) ||
    metadata.version !== 1 ||
    !isRecord(metadata.config) ||
    metadata.config.output !== "standalone" ||
    metadata.config.distDir !== ".next" ||
    typeof metadata.appDir !== "string" ||
    !path.isAbsolute(metadata.appDir) ||
    typeof metadata.config.outputFileTracingRoot !== "string" ||
    !path.isAbsolute(metadata.config.outputFileTracingRoot) ||
    !relativeAppDir
  ) {
    throw new Error("Next required-server-files metadata is incomplete or not standalone.");
  }
  const canonicalRepositoryRoot = await realpath(repositoryRoot);
  const canonicalWebRoot = await realpath(webRoot);
  const canonicalAppRoot = await realpath(metadata.appDir);
  const canonicalTracingRoot = await realpath(metadata.config.outputFileTracingRoot);
  if (
    canonicalRepositoryRoot !== canonicalTracingRoot ||
    canonicalWebRoot !== canonicalAppRoot ||
    !isInside(canonicalRepositoryRoot, canonicalAppRoot)
  ) {
    throw new Error("Next metadata does not identify this Web application.");
  }
  const derivedRelativeAppDir = path
    .relative(canonicalTracingRoot, canonicalAppRoot)
    .split(path.sep)
    .join("/");
  if (
    !isWebArtifactRelativePath(derivedRelativeAppDir) ||
    derivedRelativeAppDir !== relativeAppDir
  ) {
    throw new Error("Next relativeAppDir is not derived from its metadata roots.");
  }
  return Object.freeze({
    relativeAppDir,
    buildId: normalizedBuildId(await readFile(path.join(webBuildRoot, "BUILD_ID"), "utf8")),
    config: Object.freeze({ ...metadata.config }),
  });
}

async function assertCopiedNextIdentity(
  artifactRoot: string,
  metadata: NextStandaloneMetadata,
): Promise<void> {
  const requiredServerFiles = path.join(
    artifactRoot,
    ...webArtifactRequiredServerFilesPath(metadata.relativeAppDir).split("/"),
  );
  await requireRegularFile(requiredServerFiles, "Copied required-server-files.json");
  let copied: unknown;
  try {
    copied = JSON.parse(await readFile(requiredServerFiles, "utf8")) as unknown;
  } catch {
    throw new Error("Copied required-server-files.json is invalid JSON.");
  }
  if (
    !isRecord(copied) ||
    normalizeWebArtifactRelativePath(copied.relativeAppDir) !== metadata.relativeAppDir ||
    !isRecord(copied.config) ||
    copied.config.output !== "standalone" ||
    copied.config.distDir !== ".next"
  ) {
    throw new Error("Copied Next metadata differs from the source standalone metadata.");
  }
  const copiedBuildId = normalizedBuildId(
    await readFile(
      path.join(artifactRoot, ...webArtifactBuildIdPath(metadata.relativeAppDir).split("/")),
      "utf8",
    ),
  );
  if (copiedBuildId !== metadata.buildId) {
    throw new Error("Copied Next BUILD_ID does not match the source build identity.");
  }
}

function isRuntimeOwnedWebPackage(packageName: string): boolean {
  return (
    WEB_RUNTIME_OWNED_PACKAGES.has(packageName) || packageName.startsWith("@earendil-works/pi-")
  );
}

async function packageNameAt(directory: string): Promise<string | undefined> {
  const filename = path.join(directory, "package.json");
  try {
    const stats = await lstat(filename);
    if (!stats.isFile() || stats.isSymbolicLink()) return undefined;
    const value = JSON.parse(await readFile(filename, "utf8")) as unknown;
    return isRecord(value) && typeof value.name === "string" ? value.name : undefined;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** Final closure is fail-closed: a prune may not silently turn a missing dependency into absence. */
async function assertNoBrokenLinks(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      try {
        await realpath(absolute);
      } catch {
        const target = await readlink(absolute);
        const resolvedTarget = path.resolve(path.dirname(absolute), target);
        throw new Error(
          "Web artifact contains a broken symlink: " +
            absolute +
            " -> " +
            target +
            " (resolved as " +
            resolvedTarget +
            ").",
        );
      }
    } else if (entry.isDirectory()) {
      await assertNoBrokenLinks(absolute);
    }
  }
}

async function visitLinks(
  directory: string,
  visit: (link: string) => Promise<void>,
  skipped?: string,
): Promise<void> {
  if (!(await pathExists(directory))) return;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (skipped && path.resolve(absolute) === path.resolve(skipped)) continue;
    if (entry.isSymbolicLink()) await visit(absolute);
    else if (entry.isDirectory()) await visitLinks(absolute, visit, skipped);
  }
}

/** Rebuilds copied standalone aliases as type-correct links to artifact-confined targets. */
async function confineCopiedStandaloneLinks(
  repositoryRoot: string,
  standaloneRoot: string,
  artifactRoot: string,
): Promise<void> {
  const repositoryPnpmRoot = path.join(repositoryRoot, "node_modules", ".pnpm");
  const artifactPnpmRoot = path.join(artifactRoot, "node_modules", ".pnpm");
  await visitLinks(artifactRoot, async (artifactLink) => {
    const relativeLink = path.relative(artifactRoot, artifactLink);
    const sourceLink = path.join(standaloneRoot, relativeLink);
    const sourceTarget = await realpath(sourceLink);
    let artifactTarget: string;
    if (isInside(standaloneRoot, sourceTarget)) {
      artifactTarget = path.join(artifactRoot, path.relative(standaloneRoot, sourceTarget));
    } else if (isInside(repositoryPnpmRoot, sourceTarget)) {
      artifactTarget = path.join(artifactPnpmRoot, path.relative(repositoryPnpmRoot, sourceTarget));
    } else {
      throw new Error("Raw standalone symlink target is outside its admitted package roots.");
    }
    if (!isInside(artifactRoot, artifactTarget)) {
      throw new Error("Mapped standalone symlink target escapes the artifact root.");
    }

    const targetStats = await lstat(sourceTarget);
    if (!(await pathExists(artifactTarget))) {
      await mkdir(path.dirname(artifactTarget), { recursive: true });
      await cp(sourceTarget, artifactTarget, {
        dereference: false,
        force: true,
        preserveTimestamps: true,
        recursive: targetStats.isDirectory(),
        verbatimSymlinks: true,
      });
    }
    const relativeTarget = path
      .relative(path.dirname(artifactLink), artifactTarget)
      .split(path.sep)
      .join("/");
    await rm(artifactLink, { force: true });
    await symlink(relativeTarget, artifactLink, targetStats.isDirectory() ? "dir" : "file");
    await realpath(artifactLink);
  });
}

function pnpmEntryForTarget(pnpmDirectory: string, target: string): string | undefined {
  const relative = path.relative(pnpmDirectory, target);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative)
  ) {
    return undefined;
  }
  const entry = relative.split(path.sep)[0];
  return entry === "node_modules" ? undefined : entry;
}

/**
 * Removes only aliases whose resolved destination is one of the explicitly selected pnpm
 * entries.  Next keeps a `sharp` alias inside its retained store entry even when image
 * optimization is disabled, so deleting the store first would otherwise manufacture a broken
 * link that the strict orphan traversal must reject.
 */
async function pruneLinksToPnpmEntries(
  root: string,
  pnpmDirectory: string,
  entryNames: ReadonlySet<string>,
): Promise<void> {
  if (entryNames.size === 0) return;
  const scan = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        let target: string;
        try {
          target = await realpath(absolute);
        } catch {
          throw new Error("Web artifact contains a broken optimizer symlink: " + absolute + ".");
        }
        const pnpmEntry = pnpmEntryForTarget(pnpmDirectory, target);
        if (pnpmEntry && entryNames.has(pnpmEntry)) await rm(absolute, { force: true });
        continue;
      }
      if (entry.isDirectory()) await scan(absolute);
    }
  };
  await scan(root);
}

async function pruneOrphanPnpmEntries(
  root: string,
  additionalReachabilityRoots: readonly string[] = [],
): Promise<void> {
  const pnpmDirectory = path.join(root, ".pnpm");
  if (!(await pathExists(pnpmDirectory))) return;
  const reachable = new Set<string>();
  const pending: string[] = [];
  const enqueue = async (link: string): Promise<void> => {
    let target: string;
    try {
      target = await realpath(link);
    } catch {
      throw new Error("Web artifact contains a broken pnpm symlink: " + link + ".");
    }
    const entry = pnpmEntryForTarget(pnpmDirectory, target);
    if (!entry || reachable.has(entry)) return;
    reachable.add(entry);
    pending.push(entry);
  };
  const reachabilityRoots = [
    path.dirname(pnpmDirectory),
    ...additionalReachabilityRoots.map((directory) => path.resolve(directory)),
  ].filter((directory, index, values) => values.indexOf(directory) === index);
  for (const directory of reachabilityRoots) {
    if (directory === pnpmDirectory) continue;
    await visitLinks(directory, enqueue, pnpmDirectory);
  }
  while (pending.length > 0) {
    const entry = pending.shift();
    if (entry) await visitLinks(path.join(pnpmDirectory, entry), enqueue);
  }
  for (const entry of await readdir(pnpmDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules" || reachable.has(entry.name))
      continue;
    await rm(path.join(pnpmDirectory, entry.name), { force: true, recursive: true });
  }
  const pnpmHubDirectory = path.join(pnpmDirectory, "node_modules");
  if (await pathExists(pnpmHubDirectory)) {
    // pnpm's hub aliases are not owners. If an orphaned entry is removed above, delete only the
    // now-broken hub link; any still-needed consumer link will remain broken elsewhere and fail
    // the final closure admission below.
    await pruneBrokenHubLinks(pnpmHubDirectory);
  }
  await assertNoBrokenLinks(path.dirname(pnpmDirectory));
}

async function pruneBrokenHubLinks(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      try {
        await realpath(absolute);
      } catch {
        await rm(absolute, { force: true });
      }
      continue;
    }
    if (!entry.isDirectory()) continue;
    await pruneBrokenHubLinks(absolute);
    if ((await readdir(absolute)).length === 0) await rm(absolute, { recursive: true });
  }
}

async function pruneRuntimeOwnedPackages(
  artifactRoot: string,
  relativeAppDir: string,
): Promise<void> {
  const scanRoots = [
    ...new Set([
      path.join(artifactRoot, "node_modules"),
      path.join(artifactRoot, ...relativeAppDir.split("/"), ".next", "node_modules"),
    ]),
  ];
  const deletionRoots = new Set<string>();
  const scan = async (directory: string): Promise<void> => {
    if (!(await pathExists(directory))) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        try {
          const packageName = await packageNameAt(await realpath(absolute));
          if (packageName && isRuntimeOwnedWebPackage(packageName))
            await rm(absolute, { force: true });
        } catch {
          throw new Error("Web artifact package alias is broken: " + absolute + ".");
        }
        continue;
      }
      if (!entry.isDirectory()) continue;
      const packageName = await packageNameAt(absolute);
      if (packageName && isRuntimeOwnedWebPackage(packageName)) {
        deletionRoots.add(absolute);
      } else {
        await scan(absolute);
      }
    }
  };
  for (const root of scanRoots) await scan(root);
  for (const directory of [...deletionRoots].sort((left, right) => right.length - left.length)) {
    await rm(directory, { force: true, recursive: true });
  }
  for (const root of scanRoots) {
    if (await pathExists(root)) {
      await pruneOrphanPnpmEntries(
        root,
        scanRoots.filter((candidate) => candidate !== root),
      );
      await assertNoBrokenLinks(root);
    }
  }
}

function shouldPruneWebFile(
  relativePath: string,
  retainedRuntimeFiles: ReadonlySet<string>,
): boolean {
  const normalized = relativePath.split(path.sep).join("/");
  if (retainedRuntimeFiles.has(normalized)) return false;
  const basename = path.posix.basename(normalized);
  return (
    normalized.endsWith(".map") ||
    normalized.endsWith(".pdb") ||
    /\.(?:[cm]?ts|tsx)$/iu.test(normalized) ||
    /^(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/u.test(basename) ||
    sourceShapePolicy.isArtifactTestShapedPath(normalized) ||
    /^(?:readme|changelog)(?:\.(?:md|markdown|rst|txt))?$/iu.test(basename)
  );
}

async function pruneWebPayload(
  directory: string,
  root = directory,
  retainedRuntimeFiles: ReadonlySet<string> = new Set(),
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = artifactRelativePath(path.relative(root, absolute));
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (sourceShapePolicy.isArtifactTestDirectoryPath(relative)) {
        await rm(absolute, { force: true, recursive: true });
      } else {
        await pruneWebPayload(absolute, root, retainedRuntimeFiles);
        if ((await readdir(absolute)).length === 0) await rm(absolute, { recursive: true });
      }
    } else if (entry.isFile() && shouldPruneWebFile(relative, retainedRuntimeFiles)) {
      await rm(absolute, { force: true });
    }
  }
}

async function regularFiles(directory: string, result: string[] = []): Promise<string[]> {
  if (!(await pathExists(directory))) return result;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await regularFiles(absolute, result);
    else if (entry.isFile()) result.push(absolute);
  }
  return result;
}

async function digest(filename: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filename))
    .digest("hex");
}

/** Keep producer ordering byte-for-byte aligned with the strict public resolver/contract. */
function compareWebArtifactPaths(
  left: { readonly path: string },
  right: { readonly path: string },
): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

async function pruneDuplicateFileViewerAssets(
  artifactRoot: string,
  relativeAppDir: string,
): Promise<void> {
  const appRoot = path.join(artifactRoot, ...relativeAppDir.split("/"));
  const publicRoot = path.join(appRoot, "public", "file-viewer");
  const staticMediaRoot = path.join(appRoot, ".next", "static", "media");
  for (const relativePath of FILE_VIEWER_PRESENTATION_ASSETS) {
    if (!(await pathExists(path.join(publicRoot, ...relativePath.split("/"))))) {
      throw new Error("Missing canonical File Viewer asset: " + relativePath + ".");
    }
  }
  const publicByDigest = new Map<string, string>();
  for (const filename of await regularFiles(publicRoot))
    publicByDigest.set(await digest(filename), filename);
  for (const filename of await regularFiles(staticMediaRoot)) {
    if (publicByDigest.has(await digest(filename))) await rm(filename, { force: true });
  }
}

async function pruneNextImageOptimizer(
  artifactRoot: string,
  metadata: NextStandaloneMetadata,
): Promise<void> {
  if (!isRecord(metadata.config.images) || metadata.config.images.unoptimized !== true) {
    throw new Error("Refusing to remove sharp while Next image optimization is enabled.");
  }
  const nodeModules = path.join(artifactRoot, "node_modules");
  const pnpmDirectory = path.join(nodeModules, ".pnpm");
  if (await pathExists(pnpmDirectory)) {
    const imageOptimizerEntries = new Set(
      (await readdir(pnpmDirectory, { withFileTypes: true }))
        .filter(
          (entry) => entry.isDirectory() && /^(?:sharp@|@img\+(?:colour|sharp-))/u.test(entry.name),
        )
        .map((entry) => entry.name),
    );
    // Do not weaken pruneOrphanPnpmEntries's broken-link rejection.  Explicitly remove every
    // alias into the optimizer entries while their targets are still resolvable.
    await pruneLinksToPnpmEntries(nodeModules, pnpmDirectory, imageOptimizerEntries);
    for (const entryName of imageOptimizerEntries) {
      await rm(path.join(pnpmDirectory, entryName), { force: true, recursive: true });
    }
  }
  if (await pathExists(nodeModules)) {
    await pruneOrphanPnpmEntries(nodeModules, [
      path.join(artifactRoot, ...metadata.relativeAppDir.split("/"), ".next", "node_modules"),
    ]);
    await assertNoBrokenLinks(nodeModules);
  }
}

async function assertNoRuntimeOwnedPackages(artifactRoot: string): Promise<void> {
  const names = new Set<string>();
  const scan = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
      const packageName = await packageNameAt(absolute);
      if (packageName && isRuntimeOwnedWebPackage(packageName)) names.add(packageName);
      await scan(absolute);
    }
  };
  const nodeModules = path.join(artifactRoot, "node_modules");
  if (await pathExists(nodeModules)) await scan(nodeModules);
  if (names.size > 0) {
    throw new Error(
      "Runtime-owned packages remain in Web artifact: " + [...names].sort().join(", ") + ".",
    );
  }
}

export async function measureWebArtifactTree(artifactRoot: string): Promise<{
  readonly files: readonly WebArtifactFile[];
  readonly links: readonly WebArtifactLink[];
}> {
  const canonicalRoot = await realpath(artifactRoot);
  const files: WebArtifactFile[] = [];
  const links: WebArtifactLink[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = artifactRelativePath(path.relative(canonicalRoot, absolute));
      const stats = await lstat(absolute);
      if (stats.isSymbolicLink()) {
        let target: string;
        try {
          target = await realpath(absolute);
        } catch {
          throw new Error("Web artifact symlink is broken: " + relative + ".");
        }
        if (!isInside(canonicalRoot, target)) {
          throw new Error("Web artifact symlink escapes the artifact: " + relative + ".");
        }
        links.push(
          Object.freeze({
            path: relative,
            target: (await readlink(absolute)).split(path.sep).join("/"),
          }),
        );
      } else if (stats.isDirectory()) {
        await visit(absolute);
      } else if (stats.isFile()) {
        if (relative === WEB_ARTIFACT_MANIFEST_FILENAME) continue;
        files.push(
          Object.freeze({
            path: relative,
            size: stats.size,
            sha256: await digest(absolute),
            mode: stats.mode & 0o777,
          }),
        );
      } else {
        throw new Error("Web artifact contains unsupported entry: " + relative + ".");
      }
    }
  };
  await visit(canonicalRoot);
  return Object.freeze({
    files: Object.freeze(files.sort(compareWebArtifactPaths)),
    links: Object.freeze(links.sort(compareWebArtifactPaths)),
  });
}

async function bundleEntry(
  entryPoint: string,
  outputFile: string,
  appRoot: string,
  buildImpl: NonNullable<BuildWebArtifactOptions["buildImpl"]>,
): Promise<void> {
  const result = await buildImpl(
    createWebArtifactBuildOptions({ appRoot, entryPoint, outputFile }),
  );
  assertWebArtifactExternalPackages(result.metafile);
  await requireRegularFile(outputFile, "Bundled Web entry " + path.basename(outputFile));
}

export interface BuildWebArtifactOptions {
  readonly repositoryRoot?: string;
  readonly webRoot?: string;
  readonly webBuildRoot?: string;
  readonly standaloneRoot?: string;
  readonly publicRoot?: string;
  readonly outputDirectory?: string;
  readonly primaryEntryPoint?: string;
  readonly buildImpl?: (
    options: BuildOptions,
  ) => Promise<BuildResult<BuildOptions> & { readonly metafile: Metafile }>;
  readonly completeStandaloneRuntime?: (options: {
    readonly paths?: unknown;
    readonly standaloneRoot?: string;
  }) => unknown;
  readonly resolveArtifact?: WebArtifactResolver;
  readonly testOnlyOutputPolicy?: typeof TEST_ONLY_ALLOW_NONSTANDARD_WEB_ARTIFACT_OUTPUT;
}

export interface BuiltWebArtifact {
  readonly artifactRoot: string;
  readonly manifestPath: string;
  readonly manifest: WebArtifactManifest;
}

/** Explicit capability used only by focused tests that publish beneath a temporary repository. */
export const TEST_ONLY_ALLOW_NONSTANDARD_WEB_ARTIFACT_OUTPUT = Symbol(
  "TEST_ONLY_ALLOW_NONSTANDARD_WEB_ARTIFACT_OUTPUT",
);

type WebArtifactResolver = (
  options: ResolveWebArtifactOptions,
) => ResolvedWebArtifact | Promise<ResolvedWebArtifact>;

interface DirectoryIdentity {
  readonly device: number;
  readonly inode: number;
}

interface WebArtifactPublishLockOwner {
  readonly schemaVersion: 1;
  readonly target: "web";
  readonly pid: number;
  readonly ownerId: string;
  readonly acquiredAt: string;
}

interface WebArtifactPublishLock {
  readonly path: string;
  readonly identity: DirectoryIdentity;
  readonly owner: WebArtifactPublishLockOwner;
}

type ProcessAliveProbe = (pid: number) => boolean;

const WEB_ARTIFACT_PUBLISH_BACKUP_NAME = ".web.backup";
const WEB_ARTIFACT_PUBLISH_LOCK_NAME = ".web.publish-lock";
const WEB_ARTIFACT_PUBLISH_TEMPORARY_NAME = "w";
const WEB_ARTIFACT_PUBLISH_LOCK_INITIALIZATION_ATTEMPTS = 20;
const WEB_ARTIFACT_PUBLISH_LOCK_RETRY_MILLISECONDS = 10;
const WEB_ARTIFACT_PUBLISH_LOCK_WAIT_TIMEOUT_MILLISECONDS = 30 * 60 * 1_000;
const WEB_ARTIFACT_PUBLISH_RECOVERY_MAX_GENERATIONS = 64;

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function canonicalPathSpelling(candidate: string, label: string): string {
  if (
    typeof candidate !== "string" ||
    !path.isAbsolute(candidate) ||
    path.normalize(candidate) !== candidate ||
    path.resolve(candidate) !== candidate
  ) {
    throw new Error(label + " must be an absolute canonical path without aliases.");
  }
  return candidate;
}

async function directoryIdentity(directory: string, label: string): Promise<DirectoryIdentity> {
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(label + " must be a regular directory and not a symbolic link.");
  }
  if ((await realpath(directory)) !== directory) {
    throw new Error(label + " must be canonical and not aliased.");
  }
  return Object.freeze({ device: stats.dev, inode: stats.ino });
}

async function optionalDirectoryIdentity(
  directory: string,
  label: string,
): Promise<DirectoryIdentity | undefined> {
  try {
    return await directoryIdentity(directory, label);
  } catch (error: unknown) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

async function regularFileIdentity(filename: string, label: string): Promise<DirectoryIdentity> {
  const stats = await lstat(filename);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(label + " must be a regular file and not a symbolic link.");
  }
  return Object.freeze({ device: stats.dev, inode: stats.ino });
}

async function optionalRegularFileIdentity(
  filename: string,
  label: string,
): Promise<DirectoryIdentity | undefined> {
  try {
    return await regularFileIdentity(filename, label);
  } catch (error: unknown) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

function sameDirectoryIdentity(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

async function assertUnchangedDirectory(
  directory: string,
  expected: DirectoryIdentity,
  label: string,
): Promise<void> {
  const actual = await directoryIdentity(directory, label);
  if (!sameDirectoryIdentity(actual, expected)) {
    throw new Error(label + " changed during the Web artifact build.");
  }
}

async function assertUnchangedOptionalDirectory(
  directory: string,
  expected: DirectoryIdentity | undefined,
  label: string,
): Promise<void> {
  const actual = await optionalDirectoryIdentity(directory, label);
  if (
    expected === undefined
      ? actual !== undefined
      : !actual || !sameDirectoryIdentity(actual, expected)
  ) {
    throw new Error(label + " changed during the Web artifact build.");
  }
}

async function createOwnedTemporaryDirectory(
  parent: string,
): Promise<Readonly<{ path: string; identity: DirectoryIdentity }>> {
  // The publish lock makes a unique suffix unnecessary. Keeping this name shorter than `web`
  // preserves the final artifact's Windows path budget while copying deep pnpm package trees.
  const directory = path.join(parent, WEB_ARTIFACT_PUBLISH_TEMPORARY_NAME);
  const staleIdentity = await optionalDirectoryIdentity(
    directory,
    "Stale Web artifact temporary target",
  );
  if (staleIdentity) {
    await removeOwnedDirectory(directory, staleIdentity, "Stale Web artifact temporary target");
  }
  await mkdir(directory);
  return Object.freeze({
    path: directory,
    identity: await directoryIdentity(directory, "Web artifact temporary target"),
  });
}

async function uniqueUnusedSiblingPath(parent: string, prefix: string): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = path.join(parent, prefix + "-" + process.pid + "-" + randomUUID());
    try {
      await lstat(candidate);
    } catch (error: unknown) {
      if (isMissingPathError(error)) return candidate;
      throw error;
    }
  }
  throw new Error("Could not allocate a unique Web artifact recovery target.");
}

async function removeOwnedDirectory(
  directory: string,
  expected: DirectoryIdentity,
  label: string,
): Promise<void> {
  const actual = await optionalDirectoryIdentity(directory, label);
  if (!actual) return;
  if (!sameDirectoryIdentity(actual, expected)) {
    throw new Error(label + " is no longer owned by this build.");
  }
  await rm(directory, { force: true, recursive: true });
}

async function removeOwnedFile(
  filename: string,
  expected: DirectoryIdentity,
  label: string,
): Promise<void> {
  const actual = await optionalRegularFileIdentity(filename, label);
  if (!actual) return;
  if (!sameDirectoryIdentity(actual, expected)) {
    throw new Error(label + " is no longer owned by this build.");
  }
  await unlink(filename);
}

function webArtifactPublishLockRecoveryPath(parent: string, identity: DirectoryIdentity): string {
  return path.join(
    parent,
    WEB_ARTIFACT_PUBLISH_LOCK_NAME +
      ".recovery-" +
      identity.device.toString(16) +
      "-" +
      identity.inode.toString(16),
  );
}

function webArtifactPublishLockRecoverySuccessorPath(
  parent: string,
  identity: DirectoryIdentity,
  generation: number,
  predecessorOwnerId: string,
): string {
  const predecessorHash = createHash("sha256")
    .update(predecessorOwnerId)
    .digest("hex")
    .slice(0, 16);
  return path.join(
    parent,
    WEB_ARTIFACT_PUBLISH_LOCK_NAME +
      ".recovery-" +
      identity.device.toString(16) +
      "-" +
      identity.inode.toString(16) +
      "-" +
      generation +
      "-" +
      predecessorHash,
  );
}

function createWebArtifactPublishLockOwner(): WebArtifactPublishLockOwner {
  return Object.freeze({
    schemaVersion: 1,
    target: "web",
    pid: process.pid,
    ownerId: randomUUID(),
    acquiredAt: new Date().toISOString(),
  });
}

function assertWebArtifactPublishLockOwner(
  value: unknown,
  label: string,
): WebArtifactPublishLockOwner {
  if (!isRecord(value)) throw new Error(label + " is not an object.");
  const keys = Object.keys(value).sort();
  const expectedKeys = ["acquiredAt", "ownerId", "pid", "schemaVersion", "target"];
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error(label + " has unexpected fields.");
  }
  if (
    value.schemaVersion !== 1 ||
    value.target !== "web" ||
    !Number.isSafeInteger(value.pid) ||
    (value.pid as number) <= 0 ||
    typeof value.ownerId !== "string" ||
    value.ownerId.length === 0 ||
    value.ownerId.length > 128 ||
    typeof value.acquiredAt !== "string" ||
    !Number.isFinite(Date.parse(value.acquiredAt))
  ) {
    throw new Error(label + " is invalid for the Web artifact target.");
  }
  return Object.freeze({
    schemaVersion: 1,
    target: "web",
    pid: value.pid as number,
    ownerId: value.ownerId,
    acquiredAt: value.acquiredAt,
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
    setTimeout(resolve, WEB_ARTIFACT_PUBLISH_LOCK_RETRY_MILLISECONDS);
  });
}

async function readInitializedPublishLockOwner(
  ownerPath: string,
  expectedIdentity: DirectoryIdentity,
  label: string,
): Promise<WebArtifactPublishLockOwner | undefined> {
  let lastError: unknown;
  for (let attempt = 0; attempt < WEB_ARTIFACT_PUBLISH_LOCK_INITIALIZATION_ATTEMPTS; attempt += 1) {
    const actualIdentity = await optionalRegularFileIdentity(ownerPath, label);
    if (!actualIdentity || !sameDirectoryIdentity(actualIdentity, expectedIdentity)) {
      return undefined;
    }
    try {
      return assertWebArtifactPublishLockOwner(
        JSON.parse(await readFile(ownerPath, "utf8")) as unknown,
        label,
      );
    } catch (error: unknown) {
      lastError = error;
      await waitForPublishLockRetry();
    }
  }
  throw new Error(
    label + " is incomplete or invalid; refusing to steal an ambiguous Web artifact publish lock.",
    { cause: lastError },
  );
}

async function tryInstallAtomicPublishClaim(
  parent: string,
  claimPath: string,
  owner: WebArtifactPublishLockOwner,
  label: string,
): Promise<DirectoryIdentity | undefined> {
  const temporaryPath = path.join(
    parent,
    ".web.publish-claim-" + process.pid + "-" + randomUUID() + ".tmp",
  );
  let temporaryAtPath = false;
  let temporaryIdentity: DirectoryIdentity | undefined;
  let installed = false;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let result: DirectoryIdentity | undefined;
  let operationFailed = false;
  let operationError: unknown;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    temporaryAtPath = true;
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error(label + " temporary claim is not a regular file.");
    temporaryIdentity = Object.freeze({ device: stats.dev, inode: stats.ino });
    await handle.writeFile(JSON.stringify(owner) + "\n", "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    // The fully written, synced, and closed inode appears under the canonical name atomically.
    let linked = true;
    try {
      await link(temporaryPath, claimPath);
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") linked = false;
      else throw error;
    }
    if (linked) {
      const claimIdentity = await regularFileIdentity(claimPath, label);
      if (!sameDirectoryIdentity(claimIdentity, temporaryIdentity)) {
        throw new Error(label + " did not retain the atomically installed file identity.");
      }
      installed = true;
      result = claimIdentity;
    }
  } catch (error: unknown) {
    operationFailed = true;
    operationError = error;
  }

  const cleanupErrors: unknown[] = [];
  if (handle) {
    try {
      await handle.close();
    } catch (error: unknown) {
      cleanupErrors.push(error);
    }
  }
  if (temporaryAtPath && temporaryIdentity) {
    try {
      await removeOwnedFile(temporaryPath, temporaryIdentity, label + " temporary file");
    } catch (error: unknown) {
      // Once installed, the canonical hard link remains a complete owner. Its unique temporary
      // sibling is harmless and must not turn successful acquisition into a stranded live lock.
      if (!installed) cleanupErrors.push(error);
    }
  }
  if (operationFailed) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [operationError, ...cleanupErrors],
        label + " publication failed and temporary cleanup was incomplete.",
      );
    }
    throw operationError;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, label + " temporary cleanup was incomplete.");
  }
  return result;
}

async function tryCreateWebArtifactPublishLock(
  parent: string,
  lockPath: string,
): Promise<WebArtifactPublishLock | undefined> {
  const owner = createWebArtifactPublishLockOwner();
  const identity = await tryInstallAtomicPublishClaim(
    parent,
    lockPath,
    owner,
    "Web artifact publish lock",
  );
  if (!identity) return undefined;
  return Object.freeze({ path: lockPath, identity, owner });
}

interface WebArtifactPublishRecoveryClaim {
  readonly path: string;
  readonly identity: DirectoryIdentity;
  readonly owner: WebArtifactPublishLockOwner;
  readonly predecessors: readonly Readonly<{
    path: string;
    identity: DirectoryIdentity;
  }>[];
}

async function tryAcquireWebArtifactPublishRecoveryClaim(
  parent: string,
  parentIdentity: DirectoryIdentity,
  observedLockIdentity: DirectoryIdentity,
  processIsAliveImpl: ProcessAliveProbe,
): Promise<WebArtifactPublishRecoveryClaim | undefined> {
  let recoveryPath = webArtifactPublishLockRecoveryPath(parent, observedLockIdentity);
  const predecessors: Array<Readonly<{ path: string; identity: DirectoryIdentity }>> = [];
  for (
    let generation = 0;
    generation < WEB_ARTIFACT_PUBLISH_RECOVERY_MAX_GENERATIONS;
    generation += 1
  ) {
    await assertUnchangedDirectory(parent, parentIdentity, "Web artifact parent directory");
    const proposedOwner = createWebArtifactPublishLockOwner();
    const proposedIdentity = await tryInstallAtomicPublishClaim(
      parent,
      recoveryPath,
      proposedOwner,
      "Web artifact publish lock recovery claim",
    );
    if (proposedIdentity) {
      return Object.freeze({
        path: recoveryPath,
        identity: proposedIdentity,
        owner: proposedOwner,
        predecessors: Object.freeze([...predecessors]),
      });
    }

    const existingIdentity = await optionalRegularFileIdentity(
      recoveryPath,
      "Web artifact publish lock recovery claim",
    );
    if (!existingIdentity) return undefined;
    const existingOwner = await readInitializedPublishLockOwner(
      recoveryPath,
      existingIdentity,
      "Web artifact publish lock recovery claim",
    );
    if (!existingOwner || processIsAliveImpl(existingOwner.pid)) return undefined;
    predecessors.push(Object.freeze({ path: recoveryPath, identity: existingIdentity }));
    recoveryPath = webArtifactPublishLockRecoverySuccessorPath(
      parent,
      observedLockIdentity,
      generation + 1,
      existingOwner.ownerId,
    );
  }
  throw new Error("Web artifact publish lock recovery chain exceeds its safety limit.");
}

async function tryReclaimStaleWebArtifactPublishLock(
  lockPath: string,
  observedIdentity: DirectoryIdentity,
  observedOwner: WebArtifactPublishLockOwner,
  parent: string,
  parentIdentity: DirectoryIdentity,
  processIsAliveImpl: ProcessAliveProbe,
): Promise<boolean> {
  await assertUnchangedDirectory(parent, parentIdentity, "Web artifact parent directory");
  const recoveryClaim = await tryAcquireWebArtifactPublishRecoveryClaim(
    parent,
    parentIdentity,
    observedIdentity,
    processIsAliveImpl,
  );
  if (!recoveryClaim) return false;

  let quarantinePath: string | undefined;
  let quarantined = false;
  let recovered = false;
  let recoveryFailed = false;
  let recoveryError: unknown;
  try {
    recovered = await (async (): Promise<boolean> => {
      quarantinePath = await uniqueUnusedSiblingPath(parent, ".web.stale-publish-lock");
      await assertUnchangedDirectory(parent, parentIdentity, "Web artifact parent directory");
      const claimedIdentity = await optionalRegularFileIdentity(
        lockPath,
        "Web artifact publish lock",
      );
      if (!claimedIdentity || !sameDirectoryIdentity(claimedIdentity, observedIdentity)) {
        return false;
      }
      const currentOwner = await readInitializedPublishLockOwner(
        lockPath,
        observedIdentity,
        "Web artifact publish lock owner",
      );
      if (!currentOwner || currentOwner.ownerId !== observedOwner.ownerId) return false;
      if (processIsAliveImpl(currentOwner.pid)) return false;

      const currentRecoveryIdentity = await optionalRegularFileIdentity(
        recoveryClaim.path,
        "Web artifact publish lock recovery claim",
      );
      if (
        !currentRecoveryIdentity ||
        !sameDirectoryIdentity(currentRecoveryIdentity, recoveryClaim.identity)
      ) {
        return false;
      }
      const currentRecoveryOwner = await readInitializedPublishLockOwner(
        recoveryClaim.path,
        recoveryClaim.identity,
        "Web artifact publish lock recovery claim",
      );
      if (
        !currentRecoveryOwner ||
        currentRecoveryOwner.ownerId !== recoveryClaim.owner.ownerId ||
        currentRecoveryOwner.pid !== recoveryClaim.owner.pid
      ) {
        return false;
      }

      // This winner recheck is deliberately the final asynchronous observation before quarantine.
      await rename(lockPath, quarantinePath);
      const quarantinedIdentity = await regularFileIdentity(
        quarantinePath,
        "Stale Web artifact publish lock",
      );
      if (!sameDirectoryIdentity(quarantinedIdentity, observedIdentity)) {
        throw new Error("Stale Web artifact publish lock changed during recovery.");
      }
      quarantined = true;
      await removeOwnedFile(quarantinePath, observedIdentity, "Stale Web artifact publish lock");
      return true;
    })();
  } catch (error: unknown) {
    recoveryFailed = true;
    recoveryError = error;
  }

  const claimsToClean = quarantined
    ? [
        ...recoveryClaim.predecessors,
        Object.freeze({ path: recoveryClaim.path, identity: recoveryClaim.identity }),
      ]
    : [Object.freeze({ path: recoveryClaim.path, identity: recoveryClaim.identity })];
  const cleanupErrors: unknown[] = [];
  for (const claim of claimsToClean) {
    try {
      await removeOwnedFile(claim.path, claim.identity, "Web artifact publish lock recovery claim");
    } catch (error: unknown) {
      cleanupErrors.push(error);
    }
  }
  if (recoveryFailed) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [recoveryError, ...cleanupErrors],
        "Web artifact publish recovery failed and claim cleanup was incomplete.",
      );
    }
    throw recoveryError;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      "Web artifact publish recovery claim cleanup was incomplete.",
    );
  }
  return recovered;
}

async function acquireWebArtifactPublishLock(
  parent: string,
  parentIdentity: DirectoryIdentity,
  processIsAliveImpl: ProcessAliveProbe,
): Promise<WebArtifactPublishLock> {
  const lockPath = path.join(parent, WEB_ARTIFACT_PUBLISH_LOCK_NAME);
  const waitDeadline = Date.now() + WEB_ARTIFACT_PUBLISH_LOCK_WAIT_TIMEOUT_MILLISECONDS;
  for (;;) {
    await assertUnchangedDirectory(parent, parentIdentity, "Web artifact parent directory");
    const created = await tryCreateWebArtifactPublishLock(parent, lockPath);
    if (created) return created;

    const observedIdentity = await optionalRegularFileIdentity(
      lockPath,
      "Web artifact publish lock",
    );
    if (!observedIdentity) continue;
    const observedOwner = await readInitializedPublishLockOwner(
      lockPath,
      observedIdentity,
      "Web artifact publish lock owner",
    );
    if (!observedOwner) continue;
    if (processIsAliveImpl(observedOwner.pid)) {
      if (Date.now() >= waitDeadline) {
        throw new Error(
          "Timed out waiting for the live Web artifact publish lock; it was not stolen.",
        );
      }
      await waitForPublishLockRetry();
      continue;
    }
    if (
      await tryReclaimStaleWebArtifactPublishLock(
        lockPath,
        observedIdentity,
        observedOwner,
        parent,
        parentIdentity,
        processIsAliveImpl,
      )
    ) {
      continue;
    }
    if (Date.now() >= waitDeadline) {
      throw new Error("Timed out waiting to recover the Web artifact publish lock.");
    }
    await waitForPublishLockRetry();
  }
}

async function releaseWebArtifactPublishLock(lock: WebArtifactPublishLock): Promise<void> {
  const identity = await regularFileIdentity(lock.path, "Web artifact publish lock");
  if (!sameDirectoryIdentity(identity, lock.identity)) {
    throw new Error("Web artifact publish lock changed before release.");
  }
  const owner = await readInitializedPublishLockOwner(
    lock.path,
    lock.identity,
    "Web artifact publish lock owner",
  );
  if (!owner || owner.ownerId !== lock.owner.ownerId || owner.pid !== lock.owner.pid) {
    throw new Error("Web artifact publish lock ownership changed before release.");
  }
  await removeOwnedFile(lock.path, lock.identity, "Web artifact publish lock");
}

async function withWebArtifactPublishLock<T>(
  parent: string,
  parentIdentity: DirectoryIdentity,
  processIsAliveImpl: ProcessAliveProbe,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = await acquireWebArtifactPublishLock(parent, parentIdentity, processIsAliveImpl);
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
    await releaseWebArtifactPublishLock(lock);
  } catch (releaseError: unknown) {
    if (operationFailed) {
      throw new AggregateError(
        [operationError, releaseError],
        "Web artifact publish failed and its exclusive lock could not be released.",
      );
    }
    throw new Error("Web artifact was published, but its exclusive lock could not be released.", {
      cause: releaseError,
    });
  }
  if (operationFailed) throw operationError;
  return result as T;
}

/**
 * The producer owns exactly one published Web location.  Accepting an arbitrary directory here
 * would let a build clean or replace a sibling artifact that this app does not own.
 */
async function resolveConfinedWebArtifactOutput(
  repositoryRoot: string,
  outputDirectory: string,
  testOnlyOutputPolicy?: typeof TEST_ONLY_ALLOW_NONSTANDARD_WEB_ARTIFACT_OUTPUT,
): Promise<{
  readonly repositoryIdentity: DirectoryIdentity;
  readonly finalRoot: string;
  readonly parent: string;
  readonly parentIdentity: DirectoryIdentity;
}> {
  canonicalPathSpelling(repositoryRoot, "Web artifact repository root");
  canonicalPathSpelling(outputDirectory, "Web artifact output root");
  const repositoryIdentity = await directoryIdentity(
    repositoryRoot,
    "Web artifact repository root",
  );
  if (
    testOnlyOutputPolicy !== TEST_ONLY_ALLOW_NONSTANDARD_WEB_ARTIFACT_OUTPUT &&
    repositoryRoot !== WEB_REPOSITORY_ROOT
  ) {
    throw new Error("Web artifact repository owner must be the canonical repository root.");
  }
  const finalRoot = outputDirectory;
  const expectedFinalRoot = path.join(repositoryRoot, ".desktop-build", "web");
  if (finalRoot !== expectedFinalRoot) {
    throw new Error("Web artifact output must be the canonical .desktop-build/web subtree.");
  }
  const parent = path.dirname(finalRoot);
  const existingParent = await optionalDirectoryIdentity(parent, "Web artifact parent directory");
  if (!existingParent) {
    await assertUnchangedDirectory(
      repositoryRoot,
      repositoryIdentity,
      "Web artifact repository root",
    );
    await mkdir(parent);
  }
  const parentIdentity = await directoryIdentity(parent, "Web artifact parent directory");
  return Object.freeze({ repositoryIdentity, finalRoot, parent, parentIdentity });
}

async function admitWebArtifact(
  resolveArtifactImpl: WebArtifactResolver,
  directory: string,
  expectedBuildId?: string,
): Promise<ResolvedWebArtifact> {
  return resolveArtifactImpl({ artifactRoot: directory, expectedBuildId });
}

async function recoverInterruptedWebArtifactPublish(
  parent: string,
  finalRoot: string,
  resolveArtifactImpl: WebArtifactResolver,
  removeOwnedDirectoryImpl: typeof removeOwnedDirectory,
): Promise<DirectoryIdentity | undefined> {
  const finalIdentity = await optionalDirectoryIdentity(finalRoot, "Web artifact final target");
  const backupCandidates = (await readdir(parent))
    .filter(
      (entry) =>
        entry === WEB_ARTIFACT_PUBLISH_BACKUP_NAME ||
        entry.startsWith(WEB_ARTIFACT_PUBLISH_BACKUP_NAME + "-"),
    )
    .sort();
  if (
    backupCandidates.length > 1 ||
    (backupCandidates.length === 1 && backupCandidates[0] !== WEB_ARTIFACT_PUBLISH_BACKUP_NAME)
  ) {
    throw new Error("Web artifact publish recovery has ambiguous backup candidates.");
  }
  if (backupCandidates.length === 0) {
    // A lone final is replaceable producer-owned state. It may be corrupt precisely because this
    // rebuild is repairing it; admission is needed only to choose between two generations.
    return finalIdentity;
  }

  const backupPath = path.join(parent, WEB_ARTIFACT_PUBLISH_BACKUP_NAME);
  const backupIdentity = await directoryIdentity(
    backupPath,
    "Web artifact publish recovery backup",
  );

  if (!finalIdentity) {
    await admitWebArtifact(resolveArtifactImpl, backupPath);
    await assertUnchangedDirectory(
      backupPath,
      backupIdentity,
      "Web artifact publish recovery backup",
    );
    let restoredAtFinal = false;
    try {
      await rename(backupPath, finalRoot);
      restoredAtFinal = true;
      await assertUnchangedDirectory(
        finalRoot,
        backupIdentity,
        "Recovered Web artifact final target",
      );
      await admitWebArtifact(resolveArtifactImpl, finalRoot);
      await assertUnchangedDirectory(
        finalRoot,
        backupIdentity,
        "Recovered Web artifact final target",
      );
      return backupIdentity;
    } catch (error: unknown) {
      if (restoredAtFinal) {
        try {
          await assertUnchangedDirectory(
            finalRoot,
            backupIdentity,
            "Recovered Web artifact final target",
          );
          await rename(finalRoot, backupPath);
        } catch (rollbackError: unknown) {
          throw new AggregateError(
            [error, rollbackError],
            "Web artifact publish recovery failed and rollback was incomplete.",
          );
        }
      }
      throw error;
    }
  }

  let finalAdmissionError: unknown;
  try {
    await admitWebArtifact(resolveArtifactImpl, finalRoot);
  } catch (error: unknown) {
    finalAdmissionError = error;
  }
  if (finalAdmissionError === undefined) {
    try {
      await assertUnchangedDirectory(
        finalRoot,
        finalIdentity,
        "Interrupted Web artifact final target",
      );
      await assertUnchangedDirectory(
        backupPath,
        backupIdentity,
        "Interrupted Web artifact backup target",
      );
      await removeOwnedDirectoryImpl(
        backupPath,
        backupIdentity,
        "Web artifact publish recovery backup",
      );
    } catch (error: unknown) {
      throw new Error(
        "Recovered Web artifact was already admitted, but its old backup could not be cleaned.",
        { cause: error },
      );
    }
    return finalIdentity;
  }

  try {
    await admitWebArtifact(resolveArtifactImpl, backupPath);
  } catch (backupAdmissionError: unknown) {
    throw new AggregateError(
      [finalAdmissionError, backupAdmissionError],
      "Neither Web artifact recovery target is admitted; refusing an ambiguous recovery.",
    );
  }

  await assertUnchangedDirectory(finalRoot, finalIdentity, "Interrupted Web artifact final target");
  await assertUnchangedDirectory(
    backupPath,
    backupIdentity,
    "Interrupted Web artifact backup target",
  );

  const rejectedPath = await uniqueUnusedSiblingPath(parent, ".web.rejected-final");
  let rejectedAtPath = false;
  let backupAtFinal = false;
  let committed = false;
  try {
    await rename(finalRoot, rejectedPath);
    rejectedAtPath = true;
    await assertUnchangedDirectory(
      rejectedPath,
      finalIdentity,
      "Rejected Web artifact recovery target",
    );
    await rename(backupPath, finalRoot);
    backupAtFinal = true;
    await assertUnchangedDirectory(
      finalRoot,
      backupIdentity,
      "Recovered Web artifact final target",
    );
    await admitWebArtifact(resolveArtifactImpl, finalRoot);
    await assertUnchangedDirectory(
      finalRoot,
      backupIdentity,
      "Admitted recovered Web artifact final target",
    );
    await assertUnchangedDirectory(
      rejectedPath,
      finalIdentity,
      "Rejected Web artifact recovery target",
    );
    committed = true;
    await removeOwnedDirectoryImpl(
      rejectedPath,
      finalIdentity,
      "Rejected Web artifact recovery target",
    );
    rejectedAtPath = false;
    return backupIdentity;
  } catch (error: unknown) {
    if (committed) {
      throw new Error(
        "Recovered Web artifact was admitted, but its rejected prior target could not be cleaned.",
        { cause: error },
      );
    }
    const rollbackErrors: unknown[] = [];
    if (backupAtFinal) {
      try {
        await assertUnchangedDirectory(
          finalRoot,
          backupIdentity,
          "Recovered Web artifact final target",
        );
        await rename(finalRoot, backupPath);
        backupAtFinal = false;
      } catch (rollbackError: unknown) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rejectedAtPath) {
      try {
        await assertUnchangedDirectory(
          rejectedPath,
          finalIdentity,
          "Rejected Web artifact recovery target",
        );
        await rename(rejectedPath, finalRoot);
        rejectedAtPath = false;
      } catch (rollbackError: unknown) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Web artifact publish recovery failed and rollback was incomplete.",
      );
    }
    throw error;
  }
}

export interface PublishWebArtifactTransactionOptions {
  readonly repositoryRoot?: string;
  readonly outputDirectory?: string;
  readonly expectedBuildId: string;
  readonly resolveArtifactImpl?: WebArtifactResolver;
  readonly testOnlyOutputPolicy?: typeof TEST_ONLY_ALLOW_NONSTANDARD_WEB_ARTIFACT_OUTPUT;
  readonly testOnlyRemoveOwnedDirectoryImpl?: typeof removeOwnedDirectory;
  readonly testOnlyProcessIsAliveImpl?: ProcessAliveProbe;
  readonly buildTemporaryArtifact: (temporaryRoot: string) => Promise<void>;
}

/** Builds, publicly admits, and atomically publishes the sole canonical Web artifact target. */
export async function publishWebArtifactTransaction({
  repositoryRoot = WEB_REPOSITORY_ROOT,
  outputDirectory = DEFAULT_WEB_ARTIFACT_DIRECTORY,
  expectedBuildId,
  resolveArtifactImpl = resolveWebArtifact,
  testOnlyOutputPolicy,
  testOnlyRemoveOwnedDirectoryImpl,
  testOnlyProcessIsAliveImpl,
  buildTemporaryArtifact,
}: PublishWebArtifactTransactionOptions): Promise<ResolvedWebArtifact> {
  const usesTestCapability =
    testOnlyOutputPolicy === TEST_ONLY_ALLOW_NONSTANDARD_WEB_ARTIFACT_OUTPUT;
  if (
    !usesTestCapability &&
    (resolveArtifactImpl !== resolveWebArtifact ||
      testOnlyRemoveOwnedDirectoryImpl !== undefined ||
      testOnlyProcessIsAliveImpl !== undefined)
  ) {
    throw new Error("Web artifact test overrides require the explicit test-only capability.");
  }
  const removeOwnedDirectoryImpl = testOnlyRemoveOwnedDirectoryImpl ?? removeOwnedDirectory;
  const processIsAliveImpl = testOnlyProcessIsAliveImpl ?? currentProcessIsAlive;
  const authority = await resolveConfinedWebArtifactOutput(
    repositoryRoot,
    outputDirectory,
    testOnlyOutputPolicy,
  );

  return withWebArtifactPublishLock(
    authority.parent,
    authority.parentIdentity,
    processIsAliveImpl,
    async () => {
      await assertUnchangedDirectory(
        repositoryRoot,
        authority.repositoryIdentity,
        "Web artifact repository root",
      );
      await assertUnchangedDirectory(
        authority.parent,
        authority.parentIdentity,
        "Web artifact parent directory",
      );
      const initialFinalIdentity = await recoverInterruptedWebArtifactPublish(
        authority.parent,
        authority.finalRoot,
        resolveArtifactImpl,
        removeOwnedDirectoryImpl,
      );
      const temporary = await createOwnedTemporaryDirectory(authority.parent);
      const backupPath = path.join(authority.parent, WEB_ARTIFACT_PUBLISH_BACKUP_NAME);
      let temporaryAtPath = true;
      let publishedAtFinal = false;
      let backupAtPath = false;
      let committed = false;

      try {
        await buildTemporaryArtifact(temporary.path);
        await assertUnchangedDirectory(
          temporary.path,
          temporary.identity,
          "Web artifact temporary target",
        );
        await admitWebArtifact(resolveArtifactImpl, temporary.path, expectedBuildId);
        await assertUnchangedDirectory(
          temporary.path,
          temporary.identity,
          "Admitted Web artifact temporary target",
        );

        await assertUnchangedDirectory(
          repositoryRoot,
          authority.repositoryIdentity,
          "Web artifact repository root",
        );
        await assertUnchangedDirectory(
          authority.parent,
          authority.parentIdentity,
          "Web artifact parent directory",
        );
        await assertUnchangedOptionalDirectory(
          authority.finalRoot,
          initialFinalIdentity,
          "Web artifact final target",
        );

        if (initialFinalIdentity) {
          await rename(authority.finalRoot, backupPath);
          backupAtPath = true;
          await assertUnchangedDirectory(
            backupPath,
            initialFinalIdentity,
            "Web artifact backup target",
          );
        }

        await assertUnchangedDirectory(
          temporary.path,
          temporary.identity,
          "Web artifact temporary target before publication",
        );
        await rename(temporary.path, authority.finalRoot);
        temporaryAtPath = false;
        publishedAtFinal = true;
        await assertUnchangedDirectory(
          authority.finalRoot,
          temporary.identity,
          "Published Web artifact target",
        );
        const resolved = await admitWebArtifact(
          resolveArtifactImpl,
          authority.finalRoot,
          expectedBuildId,
        );
        await assertUnchangedDirectory(
          authority.finalRoot,
          temporary.identity,
          "Admitted published Web artifact target",
        );
        if (initialFinalIdentity) {
          await assertUnchangedDirectory(
            backupPath,
            initialFinalIdentity,
            "Web artifact backup target",
          );
        }
        committed = true;

        if (initialFinalIdentity) {
          await removeOwnedDirectoryImpl(
            backupPath,
            initialFinalIdentity,
            "Web artifact backup target",
          );
          backupAtPath = false;
        }
        return resolved;
      } catch (error: unknown) {
        if (committed) {
          throw new Error(
            "Web artifact was published and admitted, but its old backup could not be cleaned.",
            { cause: error },
          );
        }
        const rollbackErrors: unknown[] = [];
        if (publishedAtFinal) {
          try {
            await assertUnchangedDirectory(
              authority.finalRoot,
              temporary.identity,
              "Published Web artifact target",
            );
            await rename(authority.finalRoot, temporary.path);
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
              "Web artifact backup target",
            );
            await rename(backupPath, authority.finalRoot);
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
              "Web artifact temporary target",
            );
            temporaryAtPath = false;
          } catch (cleanupError: unknown) {
            rollbackErrors.push(cleanupError);
          }
        }
        if (rollbackErrors.length > 0) {
          throw new AggregateError(
            [error, ...rollbackErrors],
            "Web artifact publish failed and rollback was incomplete.",
          );
        }
        throw error;
      }
    },
  );
}

/**
 * Completes raw standalone first, then creates the final self-described Web subtree. Manifest
 * publication is strictly last, and the one host-server resolver re-admits the final result.
 */
export async function buildWebArtifact({
  repositoryRoot = WEB_REPOSITORY_ROOT,
  webRoot = WEB_APP_ROOT,
  webBuildRoot = path.join(webRoot, ".next"),
  standaloneRoot = path.join(webBuildRoot, "standalone"),
  publicRoot = path.join(webRoot, "public"),
  outputDirectory = DEFAULT_WEB_ARTIFACT_DIRECTORY,
  primaryEntryPoint = WEB_ARTIFACT_PRIMARY_SOURCE_ENTRY,
  buildImpl = build as NonNullable<BuildWebArtifactOptions["buildImpl"]>,
  completeStandaloneRuntime = standaloneTools.completeNextStandaloneRuntime,
  resolveArtifact = resolveWebArtifact,
  testOnlyOutputPolicy,
}: BuildWebArtifactOptions = {}): Promise<BuiltWebArtifact> {
  const metadata = await readNextStandaloneMetadata({ repositoryRoot, webRoot, webBuildRoot });
  await requireDirectory(standaloneRoot, "Raw Next standalone root");
  await requireDirectory(
    path.join(standaloneRoot, ...metadata.relativeAppDir.split("/")),
    "Raw Next standalone application root",
  );
  await requireDirectory(publicRoot, "Web public root");
  await requireDirectory(path.join(webBuildRoot, "static"), "Next static root");
  if (!buildImpl) throw new Error("Web artifact bundler is unavailable.");

  // Preserve the Phase-5 raw standalone seam before creating a separate final artifact copy.
  completeStandaloneRuntime({
    paths: pathTools.createWorkbenchPaths({ repositoryRoot }),
    standaloneRoot,
  });
  await assertNoBrokenLinks(standaloneRoot);

  const resolved = await publishWebArtifactTransaction({
    repositoryRoot,
    outputDirectory,
    expectedBuildId: metadata.buildId,
    resolveArtifactImpl: resolveArtifact,
    testOnlyOutputPolicy,
    async buildTemporaryArtifact(temporaryRoot) {
      await cp(standaloneRoot, temporaryRoot, {
        dereference: false,
        force: true,
        preserveTimestamps: true,
        recursive: true,
        verbatimSymlinks: true,
      });
      await confineCopiedStandaloneLinks(repositoryRoot, standaloneRoot, temporaryRoot);
      const appRoot = path.join(temporaryRoot, ...metadata.relativeAppDir.split("/"));
      await cp(publicRoot, path.join(appRoot, "public"), {
        dereference: false,
        force: true,
        preserveTimestamps: true,
        recursive: true,
        verbatimSymlinks: true,
      });
      await cp(path.join(webBuildRoot, "static"), path.join(appRoot, ".next", "static"), {
        dereference: false,
        force: true,
        preserveTimestamps: true,
        recursive: true,
        verbatimSymlinks: true,
      });
      await rm(path.join(appRoot, "server.js"), { force: true });

      await bundleEntry(
        primaryEntryPoint,
        path.join(temporaryRoot, WEB_ARTIFACT_PRIMARY_ENTRYPOINT),
        webRoot,
        buildImpl,
      );
      await pruneRuntimeOwnedPackages(temporaryRoot, metadata.relativeAppDir);
      const nextRuntimeException =
        nextRuntimeExceptionPolicy.resolveWebArtifactNextRuntimeException({
          artifactRoot: temporaryRoot,
        });
      const nextWebpackRuntime = nextRuntimeExceptionPolicy.resolveWebArtifactNextWebpackRuntime({
        artifactRoot: temporaryRoot,
      });
      await pruneWebPayload(
        temporaryRoot,
        temporaryRoot,
        new Set([
          nextRuntimeException.artifactRelativePath,
          ...nextWebpackRuntime.resources.map((resource) => resource.artifactRelativePath),
        ]),
      );
      await rm(path.join(appRoot, ".next", "cache"), { force: true, recursive: true });
      await rm(path.join(appRoot, ".next", "diagnostics"), { force: true, recursive: true });
      await rm(path.join(appRoot, ".next", "trace"), { force: true });
      await pruneDuplicateFileViewerAssets(temporaryRoot, metadata.relativeAppDir);
      await pruneNextImageOptimizer(temporaryRoot, metadata);
      await assertNoBrokenLinks(temporaryRoot);
      await assertNoRuntimeOwnedPackages(temporaryRoot);
      await assertCopiedNextIdentity(temporaryRoot, metadata);

      const inventory = await measureWebArtifactTree(temporaryRoot);
      const resources = inventory.files
        .map((file) => file.path)
        .filter((file) => file !== WEB_ARTIFACT_PRIMARY_ENTRYPOINT);
      const retainedNextRuntimeException =
        nextRuntimeExceptionPolicy.assertWebArtifactNextRuntimeExceptionResource({
          artifactRoot: temporaryRoot,
          resources,
        });
      if (
        retainedNextRuntimeException.artifactRelativePath !==
        nextRuntimeException.artifactRelativePath
      ) {
        throw new Error(
          "The physical Next next-test.js runtime dependency changed during pruning.",
        );
      }
      const retainedNextWebpackRuntime =
        nextRuntimeExceptionPolicy.assertWebArtifactNextWebpackRuntimeResources({
          artifactRoot: temporaryRoot,
          resources,
        });
      if (
        JSON.stringify(
          retainedNextWebpackRuntime.resources.map((resource) => resource.artifactRelativePath),
        ) !==
        JSON.stringify(
          nextWebpackRuntime.resources.map((resource) => resource.artifactRelativePath),
        )
      ) {
        throw new Error("The physical Next webpack runtime closure changed during pruning.");
      }
      const manifest = assertWebArtifactManifest({
        schemaVersion: WEB_ARTIFACT_MANIFEST_SCHEMA_VERSION,
        artifactKind: WEB_ARTIFACT_KIND,
        buildId: metadata.buildId,
        relativeAppDir: metadata.relativeAppDir,
        requiredServerFiles: webArtifactRequiredServerFilesPath(metadata.relativeAppDir),
        entrypoint: WEB_ARTIFACT_PRIMARY_ENTRYPOINT,
        externalPackages: WEB_ARTIFACT_EXTERNAL_PACKAGES,
        controlVersion: WEB_HOST_CONTROL_VERSION,
        requiredRuntimeHostProtocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
        shutdownContract: {
          transport: WEB_HOST_CONTROL_TRANSPORT,
          requestType: WEB_HOST_SHUTDOWN_FRAME_TYPE,
          acknowledgementType: WEB_HOST_SHUTDOWN_ACK_FRAME_TYPE,
          maximumDeadlineMs: WEB_HOST_CONTROL_MAX_SHUTDOWN_DEADLINE_MS,
        },
        resources,
        files: inventory.files,
        links: inventory.links,
      });
      await writeFile(
        path.join(temporaryRoot, WEB_ARTIFACT_MANIFEST_FILENAME),
        JSON.stringify(manifest, null, 2) + "\n",
        "utf8",
      );
    },
  });
  return Object.freeze({
    artifactRoot: resolved.artifactRoot,
    manifestPath: resolved.manifestPath,
    manifest: resolved.manifest,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void buildWebArtifact()
    .then((artifact) => {
      console.log(
        "[web-artifact] Built " +
          artifact.manifest.entrypoint +
          " for Next build " +
          artifact.manifest.buildId +
          ".",
      );
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
