import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DESKTOP_RENDERER_ARTIFACT_ENTRYPOINT,
  DESKTOP_RENDERER_ARTIFACT_KIND,
  DESKTOP_RENDERER_ARTIFACT_MANIFEST_FILENAME,
  DESKTOP_RENDERER_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  DESKTOP_RENDERER_ARTIFACT_STATIC_ROOT,
  assertDesktopRendererArtifactManifest,
  isDesktopRendererArtifactFilePath,
  type DesktopRendererArtifactFile,
  type DesktopRendererArtifactManifest,
} from "@workbench/host-contracts/desktop-renderer-artifact-manifest";
import { RUNTIME_HOST_PROTOCOL_VERSION } from "@workbench/host-contracts/runtime-host-control";

import { externalizeExecutableInlineScripts } from "./externalize-inline-scripts";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const DESKTOP_RENDERER_APP_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
export const DESKTOP_RENDERER_REPOSITORY_ROOT = path.resolve(DESKTOP_RENDERER_APP_ROOT, "../..");

const repositoryRequire = createRequire(
  path.join(DESKTOP_RENDERER_REPOSITORY_ROOT, "package.json"),
);
const pathTools = repositoryRequire("./scripts/workbench-paths.cjs") as {
  readonly createWorkbenchPaths: (options: { readonly repositoryRoot: string }) => {
    readonly desktopRendererExportRoot: string;
    readonly desktopRendererArtifactRoot: string;
  };
};
const defaultPaths = pathTools.createWorkbenchPaths({
  repositoryRoot: DESKTOP_RENDERER_REPOSITORY_ROOT,
});

export const DEFAULT_DESKTOP_RENDERER_EXPORT_DIRECTORY = defaultPaths.desktopRendererExportRoot;
export const DEFAULT_DESKTOP_RENDERER_ARTIFACT_DIRECTORY = defaultPaths.desktopRendererArtifactRoot;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

async function requireRealDirectory(value: string, label: string): Promise<void> {
  const stats = await lstat(value);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory.`);
  }
}

async function readApplicationVersion(packageJsonPath: string): Promise<string> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(packageJsonPath, "utf8")) as unknown;
  } catch {
    throw new Error("Desktop renderer package manifest is invalid JSON.");
  }
  if (!isRecord(manifest) || typeof manifest.version !== "string") {
    throw new Error("Desktop renderer package manifest has no application version.");
  }
  return manifest.version;
}

function artifactRelativePath(root: string, absolute: string): string {
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  if (!isDesktopRendererArtifactFilePath(relative)) {
    throw new Error(`Unsafe Desktop renderer artifact file: ${relative || "<root>"}.`);
  }
  return relative;
}

async function measureStaticTree(root: string): Promise<readonly DesktopRendererArtifactFile[]> {
  const files: DesktopRendererArtifactFile[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isSymbolicLink()) {
        throw new Error(`Desktop renderer artifact cannot contain a symlink: ${relative}.`);
      }
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Desktop renderer artifact contains a non-file resource: ${relative}.`);
      }
      if (relative.endsWith(".map")) {
        await rm(absolute);
        continue;
      }
      const safeRelative = artifactRelativePath(root, absolute);
      // Static assets never need execute permission. Normalize copied package modes so the same
      // immutable envelope is admissible on every Unix build host.
      await chmod(absolute, 0o644);
      const [stats, contents] = await Promise.all([lstat(absolute), readFile(absolute)]);
      files.push(
        Object.freeze({
          path: safeRelative,
          size: stats.size,
          sha256: createHash("sha256").update(contents).digest("hex"),
          mode: stats.mode & 0o777,
        }),
      );
      if (files.length > 16_384) {
        throw new Error("Desktop renderer artifact exceeds the 16384-file manifest limit.");
      }
    }
  }

  await visit(root);
  return Object.freeze(
    files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
  );
}

function contentBuildId(files: readonly DesktopRendererArtifactFile[]): string {
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(file.path);
    digest.update("\0");
    digest.update(String(file.size));
    digest.update("\0");
    digest.update(file.sha256);
    digest.update("\n");
  }
  return `sha256-${digest.digest("hex")}`;
}

async function publishArtifact(outputDirectory: string, temporaryDirectory: string): Promise<void> {
  const backupDirectory = `${outputDirectory}.backup-${randomUUID()}`;
  const hadPredecessor = await pathExists(outputDirectory);
  if (hadPredecessor) await rename(outputDirectory, backupDirectory);
  try {
    await rename(temporaryDirectory, outputDirectory);
  } catch (error) {
    if (hadPredecessor && (await pathExists(backupDirectory))) {
      await rename(backupDirectory, outputDirectory);
    }
    throw error;
  }
  if (hadPredecessor) await rm(backupDirectory, { force: true, recursive: true });
}

export interface BuildDesktopRendererArtifactOptions {
  readonly sourceDirectory?: string;
  readonly outputDirectory?: string;
  readonly packageJsonPath?: string;
  readonly applicationVersion?: string;
}

export async function buildDesktopRendererArtifact({
  sourceDirectory = DEFAULT_DESKTOP_RENDERER_EXPORT_DIRECTORY,
  outputDirectory = DEFAULT_DESKTOP_RENDERER_ARTIFACT_DIRECTORY,
  packageJsonPath = path.join(DESKTOP_RENDERER_APP_ROOT, "package.json"),
  applicationVersion,
}: BuildDesktopRendererArtifactOptions = {}): Promise<DesktopRendererArtifactManifest> {
  const resolvedSource = path.resolve(sourceDirectory);
  const resolvedOutput = path.resolve(outputDirectory);
  if (isInside(resolvedSource, resolvedOutput) || isInside(resolvedOutput, resolvedSource)) {
    throw new Error("Desktop renderer export and artifact directories must not overlap.");
  }
  await requireRealDirectory(resolvedSource, "Next static export root");
  await mkdir(path.dirname(resolvedOutput), { recursive: true });

  const temporaryDirectory = `${resolvedOutput}.partial-${randomUUID()}`;
  await rm(temporaryDirectory, { force: true, recursive: true });
  try {
    await cp(resolvedSource, temporaryDirectory, {
      dereference: false,
      force: true,
      preserveTimestamps: true,
      recursive: true,
      verbatimSymlinks: true,
    });
    await requireRealDirectory(temporaryDirectory, "Temporary Desktop renderer artifact root");
    await externalizeExecutableInlineScripts(temporaryDirectory);
    const files = await measureStaticTree(temporaryDirectory);
    const resources = files
      .map((file) => file.path)
      .filter((file) => file !== DESKTOP_RENDERER_ARTIFACT_ENTRYPOINT);
    const manifest = assertDesktopRendererArtifactManifest({
      schemaVersion: DESKTOP_RENDERER_ARTIFACT_MANIFEST_SCHEMA_VERSION,
      artifactKind: DESKTOP_RENDERER_ARTIFACT_KIND,
      applicationVersion: applicationVersion ?? (await readApplicationVersion(packageJsonPath)),
      buildId: contentBuildId(files),
      entrypoint: DESKTOP_RENDERER_ARTIFACT_ENTRYPOINT,
      staticRoot: DESKTOP_RENDERER_ARTIFACT_STATIC_ROOT,
      requiredRuntimeHostProtocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
      resources,
      files,
      links: [],
    });
    await writeFile(
      path.join(temporaryDirectory, DESKTOP_RENDERER_ARTIFACT_MANIFEST_FILENAME),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", mode: 0o644 },
    );
    await publishArtifact(resolvedOutput, temporaryDirectory);
    return manifest;
  } catch (error) {
    await rm(temporaryDirectory, { force: true, recursive: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void buildDesktopRendererArtifact()
    .then((manifest) => {
      console.log(
        `[desktop-renderer] Built ${manifest.entrypoint} for ${manifest.buildId}; ${manifest.files.length} static files.`,
      );
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Desktop renderer artifact failed.");
      process.exitCode = 1;
    });
}
