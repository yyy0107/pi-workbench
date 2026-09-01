import { RUNTIME_HOST_PROTOCOL_VERSION } from "@workbench/host-contracts/runtime-host-control";

export const DESKTOP_RENDERER_ARTIFACT_MANIFEST_SCHEMA_VERSION = 1 as const;
export const DESKTOP_RENDERER_ARTIFACT_KIND = "workbench-desktop-renderer" as const;
export const DESKTOP_RENDERER_ARTIFACT_MANIFEST_FILENAME = "artifact-manifest.json" as const;
export const DESKTOP_RENDERER_ARTIFACT_ENTRYPOINT = "index.html" as const;
export const DESKTOP_RENDERER_ARTIFACT_STATIC_ROOT = "." as const;

export interface DesktopRendererArtifactFile {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  readonly mode: number;
}

export interface DesktopRendererArtifactManifest {
  readonly schemaVersion: typeof DESKTOP_RENDERER_ARTIFACT_MANIFEST_SCHEMA_VERSION;
  readonly artifactKind: typeof DESKTOP_RENDERER_ARTIFACT_KIND;
  readonly applicationVersion: string;
  readonly buildId: string;
  readonly entrypoint: typeof DESKTOP_RENDERER_ARTIFACT_ENTRYPOINT;
  readonly staticRoot: typeof DESKTOP_RENDERER_ARTIFACT_STATIC_ROOT;
  readonly requiredRuntimeHostProtocolVersion: typeof RUNTIME_HOST_PROTOCOL_VERSION;
  /** Exact final regular files other than the static HTML entrypoint. */
  readonly resources: readonly string[];
  /** Complete measured final regular-file inventory; the manifest intentionally excludes itself. */
  readonly files: readonly DesktopRendererArtifactFile[];
  /** Static renderer artifacts are self-contained and never retain filesystem links. */
  readonly links: readonly [];
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: JsonRecord, expectedKeys: readonly string[]): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.length && expectedKeys.every((key) => Object.hasOwn(value, key))
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isApplicationVersion(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(value);
}

function isBuildId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u.test(value);
}

export function isDesktopRendererArtifactRelativePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4_096 &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    !/^[A-Za-z]:/u.test(value) &&
    value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

/** Files that imply a server/runtime closure can never enter the static renderer envelope. */
export function isDesktopRendererArtifactFilePath(value: unknown): value is string {
  if (!isDesktopRendererArtifactRelativePath(value)) return false;
  const segments = value.split("/");
  const basename = segments.at(-1)?.toLowerCase();
  return (
    value !== DESKTOP_RENDERER_ARTIFACT_MANIFEST_FILENAME &&
    segments[0] !== ".next" &&
    segments[0] !== "node_modules" &&
    basename !== "required-server-files.json" &&
    basename !== "server.js" &&
    basename !== "server.mjs" &&
    basename !== "server.cjs" &&
    !/\.(?:node|dll|dylib|exe)$/u.test(basename ?? "") &&
    !/\.so(?:\.\d+)*$/u.test(basename ?? "")
  );
}

function parseFiles(value: unknown): readonly DesktopRendererArtifactFile[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16_384) return undefined;
  const files: DesktopRendererArtifactFile[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !hasOnlyKeys(item, ["path", "size", "sha256", "mode"]) ||
      !isDesktopRendererArtifactFilePath(item.path) ||
      !isNonNegativeInteger(item.size) ||
      typeof item.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(item.sha256) ||
      !isNonNegativeInteger(item.mode) ||
      item.mode > 0o777 ||
      (item.mode & 0o111) !== 0
    ) {
      return undefined;
    }
    files.push(
      Object.freeze({ path: item.path, size: item.size, sha256: item.sha256, mode: item.mode }),
    );
  }
  const paths = files.map((file) => file.path);
  if (
    new Set(paths).size !== paths.length ||
    JSON.stringify(paths) !== JSON.stringify([...paths].sort())
  ) {
    return undefined;
  }
  return Object.freeze(files);
}

function parseResources(value: unknown): readonly string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length > 16_383 ||
    !value.every(isDesktopRendererArtifactFilePath) ||
    new Set(value).size !== value.length
  ) {
    return undefined;
  }
  const resources = [...value] as string[];
  if (JSON.stringify(resources) !== JSON.stringify([...resources].sort())) return undefined;
  return Object.freeze(resources);
}

/** Parses only the immutable, credential-free static renderer artifact envelope. */
export function parseDesktopRendererArtifactManifest(
  value: unknown,
): DesktopRendererArtifactManifest | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "artifactKind",
      "applicationVersion",
      "buildId",
      "entrypoint",
      "staticRoot",
      "requiredRuntimeHostProtocolVersion",
      "resources",
      "files",
      "links",
    ]) ||
    value.schemaVersion !== DESKTOP_RENDERER_ARTIFACT_MANIFEST_SCHEMA_VERSION ||
    value.artifactKind !== DESKTOP_RENDERER_ARTIFACT_KIND ||
    !isApplicationVersion(value.applicationVersion) ||
    !isBuildId(value.buildId) ||
    value.entrypoint !== DESKTOP_RENDERER_ARTIFACT_ENTRYPOINT ||
    value.staticRoot !== DESKTOP_RENDERER_ARTIFACT_STATIC_ROOT ||
    value.requiredRuntimeHostProtocolVersion !== RUNTIME_HOST_PROTOCOL_VERSION ||
    !Array.isArray(value.links) ||
    value.links.length !== 0
  ) {
    return undefined;
  }

  const files = parseFiles(value.files);
  const resources = parseResources(value.resources);
  if (!files || !resources) return undefined;

  const filePaths = files.map((file) => file.path);
  if (!filePaths.includes(DESKTOP_RENDERER_ARTIFACT_ENTRYPOINT)) return undefined;
  const expectedResources = filePaths.filter(
    (file) => file !== DESKTOP_RENDERER_ARTIFACT_ENTRYPOINT,
  );
  if (JSON.stringify(resources) !== JSON.stringify(expectedResources)) return undefined;

  return Object.freeze({
    schemaVersion: DESKTOP_RENDERER_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifactKind: DESKTOP_RENDERER_ARTIFACT_KIND,
    applicationVersion: value.applicationVersion,
    buildId: value.buildId,
    entrypoint: DESKTOP_RENDERER_ARTIFACT_ENTRYPOINT,
    staticRoot: DESKTOP_RENDERER_ARTIFACT_STATIC_ROOT,
    requiredRuntimeHostProtocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
    resources,
    files,
    links: Object.freeze([]) as readonly [],
  });
}

export function assertDesktopRendererArtifactManifest(
  value: unknown,
): DesktopRendererArtifactManifest {
  const manifest = parseDesktopRendererArtifactManifest(value);
  if (!manifest) throw new Error("Invalid Desktop renderer artifact manifest.");
  return manifest;
}
