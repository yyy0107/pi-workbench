import {
  RUNTIME_HOST_CONTROL_VERSION,
  RUNTIME_HOST_PROTOCOL_VERSION,
} from "@workbench/host-contracts/runtime-host-control";

export const RUNTIME_ARTIFACT_MANIFEST_SCHEMA_VERSION = 2 as const;
export const RUNTIME_ARTIFACT_KIND = "workbench-runtime-node" as const;
export const RUNTIME_ARTIFACT_MANIFEST_FILENAME = "artifact-manifest.json" as const;
export const RUNTIME_NODE_ARTIFACT_EXTERNAL_PACKAGES = Object.freeze([
  "@earendil-works/pi-coding-agent",
  "node-pty",
  "tree-sitter",
  "tree-sitter-bash",
  "ws",
]);
export const RUNTIME_NODE_ARTIFACT_DYNAMIC_PACKAGES = Object.freeze([
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
]);
export const RUNTIME_NODE_ARTIFACT_NATIVE_PACKAGES = Object.freeze([
  "node-pty",
  "tree-sitter",
  "tree-sitter-bash",
]);

export type RuntimeArtifactPlatform = "darwin" | "linux" | "win32";
export type RuntimeArtifactArchitecture = "arm64" | "x64";
export type RuntimeArtifactLibc = "glibc" | "musl" | "none";

interface RuntimeArtifactTargetBase {
  readonly platform: RuntimeArtifactPlatform;
  readonly arch: RuntimeArtifactArchitecture;
  readonly targetTriple: string;
  readonly libc: RuntimeArtifactLibc;
  readonly nodeVersion: string;
  readonly nodeModuleAbi: number;
  readonly napiVersion: number;
}

export interface NodeRuntimeArtifactTarget extends RuntimeArtifactTargetBase {
  readonly runtimeFlavor: "node";
}

export interface ElectronNodeRuntimeArtifactTarget extends RuntimeArtifactTargetBase {
  readonly runtimeFlavor: "electron-node";
  readonly electronVersion: string;
}

export type RuntimeArtifactTarget = NodeRuntimeArtifactTarget | ElectronNodeRuntimeArtifactTarget;

/**
 * The target-keyed artifact directory is part of the immutable Runtime envelope. Keep the ABI
 * and Electron version in the key so a launcher cannot accidentally select a sibling build.
 */
export function runtimeArtifactTargetKey(target: RuntimeArtifactTarget): string {
  const parsed = parseTarget(target);
  if (!parsed) throw new Error("Invalid Runtime artifact target key.");
  return [
    parsed.runtimeFlavor,
    parsed.platform,
    parsed.arch,
    parsed.libc,
    "abi" + parsed.nodeModuleAbi,
    ...(parsed.runtimeFlavor === "electron-node" ? ["electron" + parsed.electronVersion] : []),
  ].join("-");
}

export interface RuntimeArtifactNativeInventoryReference {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

export interface RuntimeArtifactNativeInventoryFile {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  /** Permission bits are measured after target materialization so executable helpers cannot drift. */
  readonly mode: number;
}

export interface RuntimeArtifactNativeInventory {
  readonly schemaVersion: 1;
  readonly target: RuntimeArtifactTarget;
  readonly files: readonly RuntimeArtifactNativeInventoryFile[];
}

export interface RuntimeArtifactLink {
  readonly path: string;
  readonly target: string;
}

export interface RuntimeArtifactManifest {
  readonly schemaVersion: typeof RUNTIME_ARTIFACT_MANIFEST_SCHEMA_VERSION;
  readonly artifactKind: typeof RUNTIME_ARTIFACT_KIND;
  readonly runtimeMode: "api-only";
  readonly controlVersion: typeof RUNTIME_HOST_CONTROL_VERSION;
  readonly hostProtocolVersion: typeof RUNTIME_HOST_PROTOCOL_VERSION;
  readonly target: RuntimeArtifactTarget;
  readonly entrypoint: string;
  readonly externalPackages: readonly string[];
  readonly dynamicPackages: readonly string[];
  readonly resources: readonly string[];
  /** Exact, artifact-derived subset of resources intentionally exposed as Pi model documentation. */
  readonly modelReadableResources: readonly string[];
  readonly nativePackages: readonly string[];
  readonly nativeInventory: RuntimeArtifactNativeInventoryReference;
  readonly links: readonly RuntimeArtifactLink[];
  readonly upgradeRequiredPaths: readonly string[];
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: JsonRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isVersion(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseNativeInventory(value: unknown): RuntimeArtifactNativeInventoryReference | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["path", "size", "sha256"]) ||
    !isArtifactRelativePath(value.path) ||
    !isPositiveInteger(value.size) ||
    typeof value.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.sha256)
  ) {
    return undefined;
  }
  return Object.freeze({ path: value.path, size: value.size, sha256: value.sha256 });
}

function isArtifactRelativePath(value: unknown): value is string {
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

export function isRuntimeArtifactNativePath(value: unknown): value is string {
  if (!isArtifactRelativePath(value)) return false;
  const basename = value.slice(value.lastIndexOf("/") + 1).toLowerCase();
  return (
    basename === "spawn-helper" ||
    /\.(?:node|dll|dylib|exe)$/u.test(basename) ||
    /\.so(?:\.\d+)*$/u.test(basename)
  );
}

export function isRuntimeArtifactCodePath(value: unknown): value is string {
  return isArtifactRelativePath(value) && /\.(?:[cm]?js)$/u.test(value);
}

export function isRuntimeArtifactResourcePath(
  value: unknown,
  {
    entrypoint,
    nativeInventoryPath,
    manifestPath = RUNTIME_ARTIFACT_MANIFEST_FILENAME,
  }: {
    readonly entrypoint: string;
    readonly nativeInventoryPath: string;
    readonly manifestPath?: string;
  },
): value is string {
  return (
    isArtifactRelativePath(value) &&
    value !== entrypoint &&
    value !== nativeInventoryPath &&
    value !== manifestPath &&
    !isRuntimeArtifactNativePath(value)
  );
}

function isPackageName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 214 &&
    (/^[a-z0-9][a-z0-9._-]*$/u.test(value) ||
      /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/u.test(value))
  );
}

function immutableStringArray(
  value: unknown,
  itemGuard: (item: unknown) => item is string,
  maximumLength: number,
): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > maximumLength || !value.every(itemGuard)) {
    return undefined;
  }
  if (new Set(value).size !== value.length) return undefined;
  return Object.freeze([...value]);
}

function immutableSortedStringArray(
  value: unknown,
  itemGuard: (item: unknown) => item is string,
  maximumLength: number,
): readonly string[] | undefined {
  const result = immutableStringArray(value, itemGuard, maximumLength);
  if (!result || JSON.stringify(result) !== JSON.stringify([...result].sort())) return undefined;
  return result;
}

function parseArtifactLinks(value: unknown): readonly RuntimeArtifactLink[] | undefined {
  if (!Array.isArray(value) || value.length > 4_096) return undefined;
  const links: RuntimeArtifactLink[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !hasOnlyKeys(item, ["path", "target"]) ||
      !isArtifactRelativePath(item.path) ||
      typeof item.target !== "string" ||
      item.target.length === 0 ||
      item.target.length > 4_096 ||
      item.target.includes("\\") ||
      item.target.includes("\0") ||
      item.target.startsWith("/") ||
      /^[A-Za-z]:/u.test(item.target)
    ) {
      return undefined;
    }
    const resolvedTarget = item.path
      .split("/")
      .slice(0, -1)
      .concat(item.target.split("/"))
      .reduce<string[]>((segments, segment) => {
        if (segment === "" || segment === ".") return segments;
        if (segment === "..") {
          if (segments.length === 0) return [".."];
          if (segments.at(-1) === "..") return [...segments, ".."];
          return segments.slice(0, -1);
        }
        return [...segments, segment];
      }, []);
    if (resolvedTarget.length === 0 || resolvedTarget[0] === "..") return undefined;
    links.push(Object.freeze({ path: item.path, target: item.target }));
  }
  const paths = links.map((link) => link.path);
  if (new Set(paths).size !== paths.length) return undefined;
  if (JSON.stringify(paths) !== JSON.stringify([...paths].sort())) return undefined;
  return Object.freeze(links);
}

function expectedTargetTriple(
  platform: RuntimeArtifactPlatform,
  arch: RuntimeArtifactArchitecture,
  libc: RuntimeArtifactLibc,
): string | undefined {
  if (platform === "darwin" && libc === "none") {
    return arch === "x64" ? "x86_64-apple-darwin" : "aarch64-apple-darwin";
  }
  if (platform === "win32" && libc === "none") {
    return arch === "x64" ? "x86_64-pc-windows-msvc" : "aarch64-pc-windows-msvc";
  }
  if (platform === "linux" && libc !== "none") {
    const cpu = arch === "x64" ? "x86_64" : "aarch64";
    return `${cpu}-unknown-linux-${libc === "glibc" ? "gnu" : "musl"}`;
  }
  return undefined;
}

function parseTarget(value: unknown): RuntimeArtifactTarget | undefined {
  if (!isRecord(value)) return undefined;
  const runtimeFlavor = value.runtimeFlavor;
  const keys = [
    "runtimeFlavor",
    "platform",
    "arch",
    "targetTriple",
    "libc",
    "nodeVersion",
    "nodeModuleAbi",
    "napiVersion",
    ...(runtimeFlavor === "electron-node" ? ["electronVersion"] : []),
  ];
  if (!hasOnlyKeys(value, keys)) return undefined;
  if (runtimeFlavor !== "node" && runtimeFlavor !== "electron-node") return undefined;
  if (value.platform !== "darwin" && value.platform !== "linux" && value.platform !== "win32") {
    return undefined;
  }
  if (value.arch !== "arm64" && value.arch !== "x64") return undefined;
  if (value.libc !== "glibc" && value.libc !== "musl" && value.libc !== "none") return undefined;
  const targetTriple = expectedTargetTriple(value.platform, value.arch, value.libc);
  if (
    targetTriple === undefined ||
    value.targetTriple !== targetTriple ||
    !isVersion(value.nodeVersion) ||
    !isPositiveInteger(value.nodeModuleAbi) ||
    !isPositiveInteger(value.napiVersion)
  ) {
    return undefined;
  }
  const base = {
    platform: value.platform,
    arch: value.arch,
    targetTriple,
    libc: value.libc,
    nodeVersion: value.nodeVersion,
    nodeModuleAbi: value.nodeModuleAbi,
    napiVersion: value.napiVersion,
  } as const;
  if (runtimeFlavor === "electron-node") {
    if (!isVersion(value.electronVersion)) return undefined;
    return Object.freeze({
      runtimeFlavor: "electron-node" as const,
      ...base,
      electronVersion: value.electronVersion,
    });
  }
  return Object.freeze({ runtimeFlavor: "node" as const, ...base });
}

/** Strictly parses the measured native payload referenced by a Runtime artifact manifest. */
export function parseRuntimeArtifactNativeInventory(
  value: unknown,
): RuntimeArtifactNativeInventory | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["schemaVersion", "target", "files"]) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.files) ||
    value.files.length > 256
  ) {
    return undefined;
  }
  const target = parseTarget(value.target);
  if (!target) return undefined;
  const files: RuntimeArtifactNativeInventoryFile[] = [];
  for (const item of value.files) {
    if (
      !isRecord(item) ||
      !hasOnlyKeys(item, ["path", "size", "sha256", "mode"]) ||
      !isRuntimeArtifactNativePath(item.path) ||
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
  if (new Set(paths).size !== paths.length) return undefined;
  if (JSON.stringify(paths) !== JSON.stringify([...paths].sort())) return undefined;
  return Object.freeze({ schemaVersion: 1, target, files: Object.freeze(files) });
}

export function assertRuntimeArtifactNativeInventory(
  value: unknown,
): RuntimeArtifactNativeInventory {
  const inventory = parseRuntimeArtifactNativeInventory(value);
  if (!inventory) throw new Error("Invalid Runtime artifact native inventory.");
  return inventory;
}

function isUpgradePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 1 &&
    value.length <= 2_048 &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("?") &&
    !value.includes("#") &&
    !value.includes("\\") &&
    !value.split("/").some((segment) => segment === "." || segment === "..")
  );
}

/** Parses the immutable build envelope only; live port, origin, token and instance identity never belong here. */
export function parseRuntimeArtifactManifest(value: unknown): RuntimeArtifactManifest | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "artifactKind",
      "runtimeMode",
      "controlVersion",
      "hostProtocolVersion",
      "target",
      "entrypoint",
      "externalPackages",
      "dynamicPackages",
      "resources",
      "modelReadableResources",
      "nativePackages",
      "nativeInventory",
      "links",
      "upgradeRequiredPaths",
    ]) ||
    value.schemaVersion !== RUNTIME_ARTIFACT_MANIFEST_SCHEMA_VERSION ||
    value.artifactKind !== RUNTIME_ARTIFACT_KIND ||
    value.runtimeMode !== "api-only" ||
    value.controlVersion !== RUNTIME_HOST_CONTROL_VERSION ||
    value.hostProtocolVersion !== RUNTIME_HOST_PROTOCOL_VERSION ||
    !isArtifactRelativePath(value.entrypoint)
  ) {
    return undefined;
  }
  const target = parseTarget(value.target);
  const externalPackages = immutableStringArray(value.externalPackages, isPackageName, 256);
  const dynamicPackages = immutableStringArray(value.dynamicPackages, isPackageName, 256);
  const resources = immutableStringArray(value.resources, isArtifactRelativePath, 4_096);
  const modelReadableResources = immutableSortedStringArray(
    value.modelReadableResources,
    isArtifactRelativePath,
    4_096,
  );
  const nativePackages = immutableStringArray(value.nativePackages, isPackageName, 256);
  const nativeInventory = parseNativeInventory(value.nativeInventory);
  const links = parseArtifactLinks(value.links);
  const upgradeRequiredPaths = immutableStringArray(value.upgradeRequiredPaths, isUpgradePath, 64);
  if (
    !target ||
    !externalPackages ||
    !dynamicPackages ||
    !resources ||
    !modelReadableResources ||
    !nativePackages ||
    !nativeInventory ||
    !links ||
    !upgradeRequiredPaths ||
    upgradeRequiredPaths.length === 0
  ) {
    return undefined;
  }
  if (!modelReadableResources.every((resource) => resources.includes(resource))) return undefined;
  return Object.freeze({
    schemaVersion: RUNTIME_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifactKind: RUNTIME_ARTIFACT_KIND,
    runtimeMode: "api-only",
    controlVersion: RUNTIME_HOST_CONTROL_VERSION,
    hostProtocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
    target,
    entrypoint: value.entrypoint,
    externalPackages,
    dynamicPackages,
    resources,
    modelReadableResources,
    nativePackages,
    nativeInventory,
    links,
    upgradeRequiredPaths,
  });
}

export function assertRuntimeArtifactManifest(value: unknown): RuntimeArtifactManifest {
  const manifest = parseRuntimeArtifactManifest(value);
  if (!manifest) throw new Error("Invalid Runtime artifact manifest.");
  return manifest;
}
