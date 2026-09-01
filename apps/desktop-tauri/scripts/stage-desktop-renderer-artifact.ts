import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DESKTOP_RENDERER_ARTIFACT_MANIFEST_FILENAME,
  assertDesktopRendererArtifactManifest,
  type DesktopRendererArtifactFile,
  type DesktopRendererArtifactManifest,
} from "@workbench/host-contracts/desktop-renderer-artifact-manifest";

const MANIFEST_MAX_BYTES = 16 * 1024 * 1024;
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const DESKTOP_TAURI_APP_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
export const DESKTOP_TAURI_REPOSITORY_ROOT = path.resolve(DESKTOP_TAURI_APP_ROOT, "../..");

const repositoryRequire = createRequire(path.join(DESKTOP_TAURI_REPOSITORY_ROOT, "package.json"));
const pathTools = repositoryRequire("./scripts/workbench-paths.cjs") as {
  readonly createWorkbenchPaths: (options: { readonly repositoryRoot: string }) => {
    readonly desktopRendererArtifactRoot: string;
    readonly desktopRendererArtifactManifestPath: string;
    readonly tauriRoot: string;
  };
};
const workbenchPaths = pathTools.createWorkbenchPaths({
  repositoryRoot: DESKTOP_TAURI_REPOSITORY_ROOT,
});

export const DEFAULT_DESKTOP_RENDERER_ARTIFACT_ROOT = workbenchPaths.desktopRendererArtifactRoot;
export const DEFAULT_DESKTOP_RENDERER_ARTIFACT_MANIFEST =
  workbenchPaths.desktopRendererArtifactManifestPath;
export const DEFAULT_TAURI_FRONTEND_DIST = path.join(workbenchPaths.tauriRoot, "dist");

export interface ResolveDesktopRendererArtifactOptions {
  readonly artifactRoot?: string;
  readonly manifestPath?: string;
  readonly expectedBuildId?: string;
}

export interface ResolvedDesktopRendererArtifact {
  readonly artifactRoot: string;
  readonly manifestPath: string;
  readonly manifest: DesktopRendererArtifactManifest;
}

function canonicalRequestedPath(value: string, label: string): string {
  if (!path.isAbsolute(value) || path.normalize(value) !== value || path.resolve(value) !== value) {
    throw new Error(`${label} must be an absolute canonical path.`);
  }
  return value;
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

async function measuredFiles(
  artifactRoot: string,
): Promise<readonly DesktopRendererArtifactFile[]> {
  const files: DesktopRendererArtifactFile[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(artifactRoot, absolute).split(path.sep).join("/");
      const stats = await lstat(absolute);
      if (stats.isSymbolicLink()) {
        throw new Error(`Desktop renderer artifact cannot contain a symlink: ${relative}.`);
      }
      if (stats.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!stats.isFile()) {
        throw new Error(`Desktop renderer artifact contains a non-file resource: ${relative}.`);
      }
      if (relative === DESKTOP_RENDERER_ARTIFACT_MANIFEST_FILENAME) continue;
      files.push(
        Object.freeze({
          path: relative,
          size: stats.size,
          sha256: createHash("sha256")
            .update(await readFile(absolute))
            .digest("hex"),
          mode: stats.mode & 0o777,
        }),
      );
      if (files.length > 16_384) {
        throw new Error("Desktop renderer artifact exceeds the 16384-file manifest limit.");
      }
    }
  }

  await visit(artifactRoot);
  return Object.freeze(
    files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
  );
}

export async function resolveDesktopRendererArtifact(
  options: ResolveDesktopRendererArtifactOptions = {},
): Promise<ResolvedDesktopRendererArtifact> {
  const artifactRoot = options.artifactRoot ?? DEFAULT_DESKTOP_RENDERER_ARTIFACT_ROOT;
  const manifestPath =
    options.manifestPath ?? path.join(artifactRoot, DESKTOP_RENDERER_ARTIFACT_MANIFEST_FILENAME);
  const requestedRoot = canonicalRequestedPath(artifactRoot, "Desktop renderer artifact root");
  const requestedManifest = canonicalRequestedPath(
    manifestPath,
    "Desktop renderer artifact manifest",
  );
  if (requestedManifest !== path.join(requestedRoot, DESKTOP_RENDERER_ARTIFACT_MANIFEST_FILENAME)) {
    throw new Error("Desktop renderer artifact root and manifest path disagree.");
  }

  const rootStats = await lstat(requestedRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("Desktop renderer artifact root must be a real directory.");
  }
  if ((await realpath(requestedRoot)) !== requestedRoot) {
    throw new Error("Desktop renderer artifact root must be canonical.");
  }
  const manifestStats = await lstat(requestedManifest);
  if (
    !manifestStats.isFile() ||
    manifestStats.isSymbolicLink() ||
    manifestStats.size <= 0 ||
    manifestStats.size > MANIFEST_MAX_BYTES ||
    (await realpath(requestedManifest)) !== requestedManifest
  ) {
    throw new Error("Desktop renderer artifact manifest must be a bounded regular file.");
  }

  let value: unknown;
  try {
    value = JSON.parse(await readFile(requestedManifest, "utf8")) as unknown;
  } catch {
    throw new Error("Desktop renderer artifact manifest is invalid JSON.");
  }
  const manifest = assertDesktopRendererArtifactManifest(value);
  if (options.expectedBuildId !== undefined && manifest.buildId !== options.expectedBuildId) {
    throw new Error(
      `Desktop renderer build identity changed: ${manifest.buildId}; expected ${options.expectedBuildId}.`,
    );
  }
  if (JSON.stringify(await measuredFiles(requestedRoot)) !== JSON.stringify(manifest.files)) {
    throw new Error("Desktop renderer artifact inventory does not match its final bytes.");
  }

  return Object.freeze({
    artifactRoot: requestedRoot,
    manifestPath: requestedManifest,
    manifest,
  });
}

export interface StageDesktopRendererArtifactOptions extends ResolveDesktopRendererArtifactOptions {
  readonly destinationRoot?: string;
}

export async function stageDesktopRendererArtifact({
  destinationRoot = DEFAULT_TAURI_FRONTEND_DIST,
  ...sourceOptions
}: StageDesktopRendererArtifactOptions = {}): Promise<ResolvedDesktopRendererArtifact> {
  const source = await resolveDesktopRendererArtifact(sourceOptions);
  const destination = canonicalRequestedPath(destinationRoot, "Tauri frontendDist");
  if (isInside(source.artifactRoot, destination) || isInside(destination, source.artifactRoot)) {
    throw new Error("Desktop renderer artifact and Tauri frontendDist must not overlap.");
  }

  const destinationParent = path.dirname(destination);
  await mkdir(destinationParent, { recursive: true });
  if ((await realpath(destinationParent)) !== destinationParent) {
    throw new Error("Tauri frontendDist parent must be canonical.");
  }

  const temporary = `${destination}.partial-${randomUUID()}`;
  await rm(temporary, { force: true, recursive: true });
  try {
    await cp(source.artifactRoot, temporary, {
      dereference: false,
      preserveTimestamps: true,
      recursive: true,
      verbatimSymlinks: true,
    });
    const staged = await resolveDesktopRendererArtifact({
      artifactRoot: temporary,
      manifestPath: path.join(temporary, DESKTOP_RENDERER_ARTIFACT_MANIFEST_FILENAME),
      expectedBuildId: source.manifest.buildId,
    });
    if (JSON.stringify(staged.manifest) !== JSON.stringify(source.manifest)) {
      throw new Error("Staged Desktop renderer manifest changed during copy.");
    }

    await rm(destination, { force: true, recursive: true });
    await rename(temporary, destination);
    return resolveDesktopRendererArtifact({
      artifactRoot: destination,
      manifestPath: path.join(destination, DESKTOP_RENDERER_ARTIFACT_MANIFEST_FILENAME),
      expectedBuildId: source.manifest.buildId,
    });
  } catch (error) {
    await rm(temporary, { force: true, recursive: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void stageDesktopRendererArtifact()
    .then(({ manifest }) => {
      console.log(
        `[desktop-tauri] Staged ${manifest.files.length} Desktop renderer files for ${manifest.buildId}.`,
      );
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Desktop renderer staging failed.");
      process.exitCode = 1;
    });
}
