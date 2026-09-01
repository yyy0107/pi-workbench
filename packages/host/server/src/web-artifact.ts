import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";

import {
  WEB_ARTIFACT_MANIFEST_FILENAME,
  assertWebArtifactManifest,
  webArtifactBuildIdPath,
  type WebArtifactFile,
  type WebArtifactLink,
  type WebArtifactManifest,
} from "@workbench/host-contracts/web-artifact-manifest";

export const WEB_ARTIFACT_MANIFEST_MAX_BYTES = 16 * 1024 * 1024;

export interface ResolveWebArtifactOptions {
  readonly artifactRoot?: string;
  readonly manifestPath?: string;
  readonly expectedBuildId?: string;
}

export interface ResolvedWebArtifact {
  readonly artifactRoot: string;
  readonly manifestPath: string;
  readonly manifest: WebArtifactManifest;
  readonly appRoot: string;
  readonly entrypoint: string;
  readonly requiredServerFiles: string;
  readonly nextConfig: Readonly<Record<string, unknown>>;
}

interface WebArtifactInventory {
  readonly files: readonly WebArtifactFile[];
  readonly links: readonly WebArtifactLink[];
}

function isPathInside(rootDirectory: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(rootDirectory), path.resolve(candidatePath));
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

function compareArtifactPaths(
  left: { readonly path: string },
  right: { readonly path: string },
): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function sha256(filename: string): string {
  return createHash("sha256").update(readFileSync(filename)).digest("hex");
}

/** Measures every final file and raw link except the self-describing manifest itself. */
function actualWebArtifactInventory(artifactRoot: string): WebArtifactInventory {
  const files: WebArtifactFile[] = [];
  const links: WebArtifactLink[] = [];

  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(artifactRoot, absolutePath).split(path.sep).join("/");
      const stats = lstatSync(absolutePath);
      if (stats.isSymbolicLink()) {
        let canonicalTarget: string;
        try {
          canonicalTarget = realpathSync(absolutePath);
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "ENOENT"
          ) {
            throw new Error(`Web artifact symlink is broken: ${relativePath}.`);
          }
          throw error;
        }
        if (!isPathInside(artifactRoot, canonicalTarget)) {
          throw new Error(`Web artifact symlink escapes the artifact: ${relativePath}.`);
        }
        links.push(Object.freeze({ path: relativePath, target: readlinkSync(absolutePath) }));
        continue;
      }
      if (stats.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!stats.isFile()) {
        throw new Error(`Web artifact contains an unsupported filesystem entry: ${relativePath}.`);
      }
      if (relativePath === WEB_ARTIFACT_MANIFEST_FILENAME) continue;
      files.push(
        Object.freeze({
          path: relativePath,
          size: stats.size,
          sha256: sha256(absolutePath),
          mode: stats.mode & 0o777,
        }),
      );
    }
  };

  visit(artifactRoot);
  return Object.freeze({
    files: Object.freeze(files.sort(compareArtifactPaths)),
    links: Object.freeze(links.sort(compareArtifactPaths)),
  });
}

function requireRegularArtifactPath(
  artifactRoot: string,
  manifest: WebArtifactManifest,
  relativePath: string,
  label: string,
): string {
  if (!manifest.files.some((file) => file.path === relativePath)) {
    throw new Error(`${label} is not owned by the Web artifact file inventory.`);
  }
  const lexicalPath = path.resolve(artifactRoot, ...relativePath.split("/"));
  if (!isPathInside(artifactRoot, lexicalPath)) {
    throw new Error(`${label} escapes the Web artifact.`);
  }
  const stats = lstatSync(lexicalPath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file.`);
  }
  const canonicalPath = realpathSync(lexicalPath);
  if (!isPathInside(artifactRoot, canonicalPath)) {
    throw new Error(`${label} realpath escapes the Web artifact.`);
  }
  return canonicalPath;
}

function parseRequiredServerFiles(filename: string): {
  readonly config: Readonly<Record<string, unknown>>;
  readonly relativeAppDir: unknown;
} {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(filename, "utf8")) as unknown;
  } catch {
    throw new Error("The Next required-server-files manifest is invalid JSON.");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("config" in value) ||
    typeof value.config !== "object" ||
    value.config === null ||
    Array.isArray(value.config)
  ) {
    throw new Error("The Next required-server-files metadata is invalid.");
  }
  return {
    config: value.config as Record<string, unknown>,
    relativeAppDir: "relativeAppDir" in value ? value.relativeAppDir : undefined,
  };
}

/**
 * Resolves the sole trusted Web artifact envelope. The exhaustive measured tree, metadata, build
 * identity, launch entry, and app root must all agree before the entrypoint can be launched.
 */
export function resolveWebArtifact({
  artifactRoot,
  manifestPath,
  expectedBuildId,
}: ResolveWebArtifactOptions = {}): ResolvedWebArtifact {
  if (!manifestPath && !artifactRoot) {
    throw new Error("A Web artifact root or manifest path is required.");
  }
  const requestedArtifactRoot = artifactRoot
    ? canonicalRequestedPath(artifactRoot, "The Web artifact root")
    : undefined;
  const requestedManifest = canonicalRequestedPath(
    manifestPath ?? path.join(requestedArtifactRoot!, WEB_ARTIFACT_MANIFEST_FILENAME),
    "The Web artifact manifest path",
  );
  if (path.basename(requestedManifest) !== WEB_ARTIFACT_MANIFEST_FILENAME) {
    throw new Error("The Web artifact manifest has an unexpected filename.");
  }
  const requestedRoot = path.dirname(requestedManifest);
  if (requestedArtifactRoot && requestedArtifactRoot !== requestedRoot) {
    throw new Error("The Web artifact root and manifest path disagree.");
  }

  const rootStats = lstatSync(requestedRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("The Web artifact root must be a regular directory.");
  }
  const canonicalRoot = realpathSync(requestedRoot);
  if (canonicalRoot !== requestedRoot) {
    throw new Error("The Web artifact root must be canonical.");
  }
  const manifestStats = lstatSync(requestedManifest);
  if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) {
    throw new Error("The Web artifact manifest must be a regular file.");
  }
  if (manifestStats.size <= 0 || manifestStats.size > WEB_ARTIFACT_MANIFEST_MAX_BYTES) {
    throw new Error("The Web artifact manifest has an invalid size.");
  }
  const canonicalManifest = realpathSync(requestedManifest);
  if (canonicalManifest !== requestedManifest || !isPathInside(canonicalRoot, canonicalManifest)) {
    throw new Error("The Web artifact manifest must be canonical and confined.");
  }

  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(readFileSync(canonicalManifest, "utf8")) as unknown;
  } catch {
    throw new Error("The Web artifact manifest is invalid JSON.");
  }
  const manifest = assertWebArtifactManifest(manifestValue);
  if (expectedBuildId !== undefined && manifest.buildId !== expectedBuildId) {
    throw new Error(
      `Web artifact build identity changed: ${manifest.buildId}; expected ${expectedBuildId}.`,
    );
  }

  const actualInventory = actualWebArtifactInventory(canonicalRoot);
  if (JSON.stringify(actualInventory.files) !== JSON.stringify(manifest.files)) {
    throw new Error("The Web artifact regular-file inventory does not match its final bytes.");
  }
  if (JSON.stringify(actualInventory.links) !== JSON.stringify(manifest.links)) {
    throw new Error("The Web artifact symlink inventory does not match its final link targets.");
  }

  const entrypoint = requireRegularArtifactPath(
    canonicalRoot,
    manifest,
    manifest.entrypoint,
    "Web artifact primary entrypoint",
  );
  const requiredServerFiles = requireRegularArtifactPath(
    canonicalRoot,
    manifest,
    manifest.requiredServerFiles,
    "Next required-server-files manifest",
  );
  const buildIdPath = requireRegularArtifactPath(
    canonicalRoot,
    manifest,
    webArtifactBuildIdPath(manifest.relativeAppDir),
    "Next BUILD_ID",
  );
  if (readFileSync(buildIdPath, "utf8").trim() !== manifest.buildId) {
    throw new Error("The Next BUILD_ID does not match the Web artifact build identity.");
  }

  const requiredServerManifest = parseRequiredServerFiles(requiredServerFiles);
  if (
    requiredServerManifest.relativeAppDir !== manifest.relativeAppDir ||
    requiredServerManifest.config.output !== "standalone"
  ) {
    throw new Error("The Next required-server-files metadata does not match the Web artifact.");
  }

  const lexicalAppRoot = path.resolve(canonicalRoot, ...manifest.relativeAppDir.split("/"));
  if (!isPathInside(canonicalRoot, lexicalAppRoot)) {
    throw new Error("The manifest-derived Web app root escapes the artifact.");
  }
  const appStats = lstatSync(lexicalAppRoot);
  if (!appStats.isDirectory() || appStats.isSymbolicLink()) {
    throw new Error("The manifest-derived Web app root must be a regular directory.");
  }
  const appRoot = realpathSync(lexicalAppRoot);
  if (appRoot !== lexicalAppRoot || !isPathInside(canonicalRoot, appRoot)) {
    throw new Error("The manifest-derived Web app root must be canonical and confined.");
  }

  return Object.freeze({
    appRoot,
    artifactRoot: canonicalRoot,
    entrypoint,
    manifest,
    manifestPath: canonicalManifest,
    nextConfig: Object.freeze({ ...requiredServerManifest.config }),
    requiredServerFiles,
  });
}
