import { RUNTIME_HOST_PROTOCOL_VERSION } from "@workbench/host-contracts/runtime-host-control";
import {
  WEB_HOST_CONTROL_MAX_SHUTDOWN_DEADLINE_MS,
  WEB_HOST_CONTROL_TRANSPORT,
  WEB_HOST_CONTROL_VERSION,
  WEB_HOST_SHUTDOWN_ACK_FRAME_TYPE,
  WEB_HOST_SHUTDOWN_FRAME_TYPE,
} from "@workbench/host-contracts/web-host-control";

export const WEB_ARTIFACT_MANIFEST_SCHEMA_VERSION = 2 as const;
export const WEB_ARTIFACT_KIND = "workbench-web" as const;
export const WEB_ARTIFACT_MANIFEST_FILENAME = "artifact-manifest.json" as const;
export const WEB_ARTIFACT_PRIMARY_ENTRYPOINT = "web-server.mjs" as const;
export const WEB_ARTIFACT_EXTERNAL_PACKAGES = Object.freeze(["next"] as const);

/** Paths derived solely from Next's metadata-owned relative app directory. */
export function webArtifactRequiredServerFilesPath(relativeAppDir: string): string {
  return `${relativeAppDir}/.next/required-server-files.json`;
}

/** The measured Next build identity; consumers must compare its trimmed bytes with `buildId`. */
export function webArtifactBuildIdPath(relativeAppDir: string): string {
  return `${relativeAppDir}/.next/BUILD_ID`;
}

export interface WebArtifactFile {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  readonly mode: number;
}

export interface WebArtifactLink {
  readonly path: string;
  /** The platform-neutral `readlink` target measured from the final artifact tree. */
  readonly target: string;
}

export interface WebArtifactShutdownContract {
  readonly transport: typeof WEB_HOST_CONTROL_TRANSPORT;
  readonly requestType: typeof WEB_HOST_SHUTDOWN_FRAME_TYPE;
  readonly acknowledgementType: typeof WEB_HOST_SHUTDOWN_ACK_FRAME_TYPE;
  readonly maximumDeadlineMs: typeof WEB_HOST_CONTROL_MAX_SHUTDOWN_DEADLINE_MS;
}

export interface WebArtifactManifest {
  readonly schemaVersion: typeof WEB_ARTIFACT_MANIFEST_SCHEMA_VERSION;
  readonly artifactKind: typeof WEB_ARTIFACT_KIND;
  readonly buildId: string;
  /** Next's `required-server-files.json#relativeAppDir`, never a caller-derived path. */
  readonly relativeAppDir: string;
  readonly requiredServerFiles: string;
  /** The primary independent Web-only control entry. */
  readonly entrypoint: typeof WEB_ARTIFACT_PRIMARY_ENTRYPOINT;
  readonly externalPackages: readonly (typeof WEB_ARTIFACT_EXTERNAL_PACKAGES)[number][];
  readonly controlVersion: typeof WEB_HOST_CONTROL_VERSION;
  readonly requiredRuntimeHostProtocolVersion: typeof RUNTIME_HOST_PROTOCOL_VERSION;
  readonly shutdownContract: WebArtifactShutdownContract;
  /** Exact final regular files other than the sole externally launchable control entry. */
  readonly resources: readonly string[];
  /** Complete measured final regular-file inventory; the manifest intentionally excludes itself. */
  readonly files: readonly WebArtifactFile[];
  /** Complete measured final symlink inventory. */
  readonly links: readonly WebArtifactLink[];
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

export function isWebArtifactRelativePath(value: unknown): value is string {
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

/** Normalizes platform-native Next metadata without relaxing the canonical manifest format. */
export function normalizeWebArtifactRelativePath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replaceAll("\\", "/");
  return isWebArtifactRelativePath(normalized) ? normalized : undefined;
}

function isBuildId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,255}$/u.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function sortedStrings(value: unknown, maximumLength: number): readonly string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length > maximumLength ||
    !value.every(isWebArtifactRelativePath) ||
    new Set(value).size !== value.length
  ) {
    return undefined;
  }
  const strings = [...value] as string[];
  if (JSON.stringify(strings) !== JSON.stringify([...strings].sort())) return undefined;
  return Object.freeze(strings);
}

function resolveLinkTarget(linkPath: string, rawTarget: string): readonly string[] | undefined {
  const segments = linkPath
    .split("/")
    .slice(0, -1)
    .concat(rawTarget.split("/"))
    .reduce<string[]>((result, segment) => {
      if (segment === "" || segment === ".") return result;
      if (segment === "..") {
        if (result.length === 0) return [".."];
        if (result.at(-1) === "..") return [...result, ".."];
        return result.slice(0, -1);
      }
      return [...result, segment];
    }, []);
  return segments.length === 0 || segments[0] === ".." ? undefined : Object.freeze(segments);
}

function parseFiles(value: unknown): readonly WebArtifactFile[] | undefined {
  if (!Array.isArray(value) || value.length > 16_384) return undefined;
  const files: WebArtifactFile[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !hasOnlyKeys(item, ["path", "size", "sha256", "mode"]) ||
      !isWebArtifactRelativePath(item.path) ||
      item.path === WEB_ARTIFACT_MANIFEST_FILENAME ||
      !isNonNegativeInteger(item.size) ||
      typeof item.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(item.sha256) ||
      !isNonNegativeInteger(item.mode) ||
      item.mode > 0o777
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

function parseLinks(value: unknown): readonly WebArtifactLink[] | undefined {
  if (!Array.isArray(value) || value.length > 16_384) return undefined;
  const links: WebArtifactLink[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !hasOnlyKeys(item, ["path", "target"]) ||
      !isWebArtifactRelativePath(item.path) ||
      item.path === WEB_ARTIFACT_MANIFEST_FILENAME ||
      typeof item.target !== "string" ||
      item.target.length === 0 ||
      item.target.length > 4_096 ||
      item.target.includes("\\") ||
      item.target.includes("\0") ||
      item.target.startsWith("/") ||
      /^[A-Za-z]:/u.test(item.target) ||
      !resolveLinkTarget(item.path, item.target)
    ) {
      return undefined;
    }
    links.push(Object.freeze({ path: item.path, target: item.target }));
  }
  const paths = links.map((link) => link.path);
  if (
    new Set(paths).size !== paths.length ||
    JSON.stringify(paths) !== JSON.stringify([...paths].sort())
  ) {
    return undefined;
  }
  return Object.freeze(links);
}

function parseShutdownContract(value: unknown): WebArtifactShutdownContract | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["transport", "requestType", "acknowledgementType", "maximumDeadlineMs"]) ||
    value.transport !== WEB_HOST_CONTROL_TRANSPORT ||
    value.requestType !== WEB_HOST_SHUTDOWN_FRAME_TYPE ||
    value.acknowledgementType !== WEB_HOST_SHUTDOWN_ACK_FRAME_TYPE ||
    value.maximumDeadlineMs !== WEB_HOST_CONTROL_MAX_SHUTDOWN_DEADLINE_MS
  ) {
    return undefined;
  }
  return Object.freeze({
    transport: WEB_HOST_CONTROL_TRANSPORT,
    requestType: WEB_HOST_SHUTDOWN_FRAME_TYPE,
    acknowledgementType: WEB_HOST_SHUTDOWN_ACK_FRAME_TYPE,
    maximumDeadlineMs: WEB_HOST_CONTROL_MAX_SHUTDOWN_DEADLINE_MS,
  });
}

/** Parses the immutable artifact envelope only; live origin, port, token and process identity stay out. */
export function parseWebArtifactManifest(value: unknown): WebArtifactManifest | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "artifactKind",
      "buildId",
      "relativeAppDir",
      "requiredServerFiles",
      "entrypoint",
      "externalPackages",
      "controlVersion",
      "requiredRuntimeHostProtocolVersion",
      "shutdownContract",
      "resources",
      "files",
      "links",
    ]) ||
    value.schemaVersion !== WEB_ARTIFACT_MANIFEST_SCHEMA_VERSION ||
    value.artifactKind !== WEB_ARTIFACT_KIND ||
    !isBuildId(value.buildId) ||
    !isWebArtifactRelativePath(value.relativeAppDir) ||
    value.requiredServerFiles !== webArtifactRequiredServerFilesPath(value.relativeAppDir) ||
    value.entrypoint !== WEB_ARTIFACT_PRIMARY_ENTRYPOINT ||
    value.controlVersion !== WEB_HOST_CONTROL_VERSION ||
    value.requiredRuntimeHostProtocolVersion !== RUNTIME_HOST_PROTOCOL_VERSION
  ) {
    return undefined;
  }
  const externalPackages = sortedStrings(value.externalPackages, 16);
  const resources = sortedStrings(value.resources, 16_384);
  const files = parseFiles(value.files);
  const links = parseLinks(value.links);
  const shutdownContract = parseShutdownContract(value.shutdownContract);
  if (
    !externalPackages ||
    JSON.stringify(externalPackages) !== JSON.stringify(WEB_ARTIFACT_EXTERNAL_PACKAGES) ||
    !resources ||
    !files ||
    !links ||
    !shutdownContract
  ) {
    return undefined;
  }

  const filePaths = files.map((file) => file.path);
  const linkPaths = links.map((link) => link.path);
  const legacyNextEntrypoint = `${value.relativeAppDir}/server.js`;
  const nextBuildId = webArtifactBuildIdPath(value.relativeAppDir);
  if (
    new Set([...filePaths, ...linkPaths]).size !== filePaths.length + linkPaths.length ||
    !filePaths.includes(WEB_ARTIFACT_PRIMARY_ENTRYPOINT) ||
    // Next's old custom-server entry is removed before the final inventory.  It
    // must not be smuggled back through either inventory kind.
    filePaths.includes(legacyNextEntrypoint) ||
    linkPaths.includes(legacyNextEntrypoint)
  ) {
    return undefined;
  }
  const expectedResources = filePaths.filter((file) => file !== WEB_ARTIFACT_PRIMARY_ENTRYPOINT);
  if (
    JSON.stringify(resources) !== JSON.stringify(expectedResources) ||
    // The required-server-files descriptor is a regular final resource, not a
    // path declaration that a launcher may resolve independently.
    !filePaths.includes(value.requiredServerFiles) ||
    !resources.includes(value.requiredServerFiles) ||
    // The build ID has the same identity role: a descriptor cannot substitute a
    // link or invent a buildId divorced from the measured Next artifact bytes.
    !filePaths.includes(nextBuildId) ||
    !resources.includes(nextBuildId)
  ) {
    return undefined;
  }

  return Object.freeze({
    schemaVersion: WEB_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifactKind: WEB_ARTIFACT_KIND,
    buildId: value.buildId,
    relativeAppDir: value.relativeAppDir,
    requiredServerFiles: value.requiredServerFiles,
    entrypoint: WEB_ARTIFACT_PRIMARY_ENTRYPOINT,
    externalPackages: Object.freeze([...WEB_ARTIFACT_EXTERNAL_PACKAGES]),
    controlVersion: WEB_HOST_CONTROL_VERSION,
    requiredRuntimeHostProtocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
    shutdownContract,
    resources,
    files,
    links,
  });
}

export function assertWebArtifactManifest(value: unknown): WebArtifactManifest {
  const manifest = parseWebArtifactManifest(value);
  if (!manifest) throw new Error("Invalid Web artifact manifest.");
  return manifest;
}
