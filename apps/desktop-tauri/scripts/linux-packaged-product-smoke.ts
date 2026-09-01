import { createHash } from "node:crypto";
import {
  execFile as execFileCallback,
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { createReadStream } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  RUNTIME_ARTIFACT_MANIFEST_FILENAME,
  RUNTIME_NODE_ARTIFACT_DYNAMIC_PACKAGES,
  RUNTIME_NODE_ARTIFACT_EXTERNAL_PACKAGES,
  RUNTIME_NODE_ARTIFACT_NATIVE_PACKAGES,
  parseRuntimeArtifactNativeInventory,
  parseRuntimeArtifactManifest,
  type NodeRuntimeArtifactTarget,
  type RuntimeArtifactNativeInventory,
} from "@workbench/host-contracts/runtime-artifact-manifest";

import {
  TAURI_SIDECAR_ENVELOPE_FILENAME,
  digestLinkFreeTree,
  parseTauriSidecarEnvelope,
  serializeTauriSidecarEnvelope,
  type TauriSidecarEnvelope,
} from "./tauri-sidecar-envelope";

const execFile = promisify(execFileCallback);
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const DEFAULT_DEB_DIRECTORY = path.join(
  APP_ROOT,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "deb",
);
const MAIN_EXECUTABLE = "workbench-desktop-tauri";
const SIDECAR_EXECUTABLE = "workbench-runtime-node";
const RESULT_TYPE = "workbench-tauri-packaged-product-smoke";
const PRODUCT_WINDOW_TITLE = "Pi Workbench";
export const PRODUCT_TERMINAL_TOGGLE_COMMAND_TITLES = Object.freeze([
  Object.freeze({ locale: "en-US", title: "Toggle terminal" }),
  Object.freeze({ locale: "zh-CN", title: "切换终端" }),
]);
export const PRODUCT_RUNTIME_RESTART_COMMAND_TITLES = Object.freeze([
  Object.freeze({ locale: "en-US", title: "Restart local service" }),
  Object.freeze({ locale: "zh-CN", title: "重启本地服务" }),
]);
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_CHILD_OUTPUT_BYTES = 256 * 1024;
const CENSUS_INTERVAL_MS = 40;
const CREDENTIAL_MATERIAL_PATTERN =
  /(?:authorization["']?\s*[:=]\s*bearer\s+\S+|(?:access[_-]?token|workbench_runtime_access_token)["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}|(?:https?|wss?):\/\/[^\s]*[?&](?:token|access_token)=)/iu;

export const LINUX_WINDOW_MANAGER_SESSION_COMMAND = Object.freeze({
  executable: "dbus-run-session",
  args: Object.freeze(["--", "metacity", "--sm-disable", "--replace"]),
});

export interface CommandOutput {
  readonly stdout: string;
  readonly stderr: string;
}

export type CommandRunner = (
  executable: string,
  args: readonly string[],
  options?: Readonly<{
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  }>,
) => Promise<CommandOutput>;

export type ProcessSpawner = (
  executable: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface LinuxProcessIdentity {
  readonly pid: number;
  readonly startTimeTicks: string;
}

export interface LinuxProcessSnapshot extends LinuxProcessIdentity {
  readonly ppid: number;
  readonly processGroupId: number;
  readonly sessionId: number;
  readonly ttyNumber: number;
  readonly executable?: string;
  readonly cwd?: string;
  readonly stdinTarget?: string;
  readonly socketInodes: readonly string[];
  readonly credentialMaterialPresent: boolean;
}

export interface PackagedRuntimeLayout {
  readonly extractionRoot: string;
  readonly mainExecutable: string;
  readonly sidecarExecutable: string;
  readonly runtimeRoot: string;
  readonly envelopePath: string;
  readonly envelope: TauriSidecarEnvelope;
  readonly envelopeSha256: string;
  readonly nativeInventory: RuntimeArtifactNativeInventory;
}

export interface SidecarRuntimeProbe {
  readonly runtimeFlavor: "node";
  readonly platform: string;
  readonly arch: string;
  readonly nodeVersion: string;
  readonly nodeModuleAbi: number;
  readonly napiVersion: number;
  readonly glibcVersionRuntime?: string;
}

export interface DebPackageMetadata {
  readonly packageName: string;
  readonly version: string;
  readonly architecture: string;
}

export interface InspectPackagedRuntimeOptions {
  readonly packageMetadata: DebPackageMetadata;
  readonly probeSidecar?: (
    executable: string,
    commandRunner: CommandRunner,
  ) => Promise<SidecarRuntimeProbe>;
  readonly commandRunner?: CommandRunner;
}

export interface LinuxPackagedProductSmokeOptions {
  readonly debPath?: string;
  readonly shutdownMode?: "graceful" | "hard-death";
  readonly timeoutMs?: number;
  readonly commandRunner?: CommandRunner;
  readonly spawnProcess?: ProcessSpawner;
  readonly readProcessCensus?: (
    procRoot?: string,
  ) => Promise<ReadonlyMap<number, LinuxProcessSnapshot>>;
  readonly delay?: (milliseconds: number) => Promise<void>;
}

interface FileMeasurement {
  readonly size: number;
  readonly sha256: string;
}

interface ExitStatus {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface CapturedChild {
  readonly child: ChildProcess;
  readonly exit: Promise<ExitStatus>;
  readonly output: () => Readonly<{ stdout: string; stderr: string; overflow: boolean }>;
}

interface DisplayOwner {
  readonly display: string;
  readonly xvfb: CapturedChild;
  readonly windowManager: CapturedChild;
}

interface ManagedWindow {
  readonly id: string;
  readonly pid: number;
  readonly title: string;
}

export interface ProductWindow {
  readonly id: string;
  readonly title: typeof PRODUCT_WINDOW_TITLE;
}

export interface LinuxTcpSocketSnapshot {
  readonly inode: string;
  readonly localPort: number;
  readonly state: string;
}

interface ObservedTopology {
  readonly tracked: Map<string, LinuxProcessSnapshot>;
  readonly generations: ObservedRuntimeGeneration[];
  tauri?: LinuxProcessSnapshot;
  watchdog?: LinuxProcessSnapshot;
  host?: LinuxProcessSnapshot;
  pty?: LinuxProcessSnapshot;
  readonly hostPorts: Set<number>;
  credentialMaterialPresent: boolean;
  topologyFailure?: string;
}

interface ObservedRuntimeGeneration {
  readonly watchdog: LinuxProcessSnapshot;
  readonly host: LinuxProcessSnapshot;
  pty?: LinuxProcessSnapshot;
  readonly hostPorts: Set<number>;
}

export interface OwnedPackagedProcessTopology {
  readonly owned: readonly LinuxProcessSnapshot[];
  readonly tauri?: LinuxProcessSnapshot;
  readonly watchdog?: LinuxProcessSnapshot;
  readonly host?: LinuxProcessSnapshot;
  readonly pty?: LinuxProcessSnapshot;
  readonly credentialMaterialPresent: boolean;
}

export interface LinuxExactProcessGroupScope {
  readonly processGroupId: number;
  readonly watchdog: LinuxProcessSnapshot;
  readonly host: LinuxProcessSnapshot;
  readonly members: readonly LinuxProcessSnapshot[];
  readonly ptyInsideScope: boolean;
}

function parseManagedWindowLine(line: string): ManagedWindow | undefined {
  const match = line.match(/^(0x[0-9a-f]+)\s+\S+\s+(\d+)\s+\S+\s+(.*)$/iu);
  if (!match) return undefined;
  const pid = Number(match[2]);
  if (!Number.isSafeInteger(pid) || pid < 1) return undefined;
  return Object.freeze({ id: match[1], pid, title: match[3] });
}

/** Admit only the exact production window owned by the expected Tauri process. */
export function parseProductWindowLine(
  line: string,
  expectedPid: number,
): ProductWindow | undefined {
  const window = parseManagedWindowLine(line);
  if (window?.pid !== expectedPid || window.title !== PRODUCT_WINDOW_TITLE) return undefined;
  return Object.freeze({ id: window.id, title: PRODUCT_WINDOW_TITLE });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function identityKey(identity: LinuxProcessIdentity): string {
  return `${identity.pid}:${identity.startTimeTicks}`;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function exactJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertNoCredentialMaterial(value: string, label: string): void {
  if (CREDENTIAL_MATERIAL_PATTERN.test(value)) {
    throw new Error(`${label} contained Runtime credential material.`);
  }
}

export const runCommand: CommandRunner = async (executable, args, options = {}) => {
  try {
    const result = await execFile(executable, [...args], {
      cwd: options.cwd,
      encoding: "utf8",
      env: options.env,
      maxBuffer: MAX_CHILD_OUTPUT_BYTES,
      timeout: options.timeoutMs,
      windowsHide: true,
    });
    return { stdout: String(result.stdout), stderr: String(result.stderr) };
  } catch {
    throw new Error(`Packaged smoke command ${path.basename(executable)} failed.`);
  }
};

async function measureFile(file: string): Promise<FileMeasurement> {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error("Packaged artifact entry must be a regular file.");
  }
  if (process.platform !== "win32" && before.nlink !== 1) {
    throw new Error("Packaged artifact entry must not be hard-linked.");
  }
  const digest = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    digest.update(buffer);
  }
  const after = await lstat(file);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    size !== before.size
  ) {
    throw new Error("Packaged artifact entry changed while it was measured.");
  }
  return Object.freeze({ size, sha256: digest.digest("hex") });
}

async function walkRegularFiles(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  await visit(root);
  return files;
}

function uniqueBasename(files: readonly string[], basename: string, label: string): string {
  const matches = files.filter((file) => path.basename(file) === basename);
  if (matches.length !== 1) {
    throw new Error(`Extracted Debian package must contain exactly one ${label}.`);
  }
  return matches[0];
}

async function verifyNativeInventory(
  runtimeRoot: string,
  inventory: RuntimeArtifactNativeInventory,
  target: NodeRuntimeArtifactTarget,
): Promise<void> {
  if (!exactJson(inventory.target, target)) {
    throw new Error("Packaged native inventory target does not match the sidecar envelope.");
  }
  for (const expected of inventory.files) {
    const absolute = path.join(runtimeRoot, ...expected.path.split("/"));
    if (!isInside(runtimeRoot, absolute)) {
      throw new Error("Packaged native inventory path escaped the Runtime root.");
    }
    const measurement = await measureFile(absolute);
    const fileStats = await stat(absolute);
    if (measurement.size !== expected.size || measurement.sha256 !== expected.sha256) {
      throw new Error("Packaged native inventory entry drifted from its manifest.");
    }
    // Debian materialization removes group/other write bits from payload entries. Admit only that
    // deterministic permission narrowing; the package may neither add access nor change any other
    // inventory-owned mode bit.
    const packagedMode = expected.mode & ~0o022;
    if ((fileStats.mode & 0o777) !== packagedMode) {
      throw new Error("Packaged native inventory permissions are not safely normalized.");
    }
  }
}

function expectedDebArchitecture(target: NodeRuntimeArtifactTarget): string {
  if (target.arch === "x64") return "amd64";
  if (target.arch === "arm64") return "arm64";
  throw new Error("The sidecar envelope contains an unsupported Debian architecture.");
}

export async function probePackagedSidecar(
  executable: string,
  commandRunner: CommandRunner = runCommand,
): Promise<SidecarRuntimeProbe> {
  const script = [
    "const header = process.report?.getReport().header ?? {};",
    "process.stdout.write(JSON.stringify({",
    "runtimeFlavor:'node',platform:process.platform,arch:process.arch,",
    "nodeVersion:process.versions.node,nodeModuleAbi:Number(process.versions.modules),",
    "napiVersion:Number(process.versions.napi),glibcVersionRuntime:header.glibcVersionRuntime",
    "}));",
  ].join("");
  const { stdout, stderr } = await commandRunner(
    executable,
    ["--input-type=module", "-e", script],
    {
      env: {
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        PATH: process.env.PATH,
      },
      timeoutMs: 15_000,
    },
  );
  assertNoCredentialMaterial(stdout, "Sidecar identity probe stdout");
  assertNoCredentialMaterial(stderr, "Sidecar identity probe stderr");
  if (stderr.trim() !== "") throw new Error("Packaged sidecar identity probe wrote stderr.");
  let value: unknown;
  try {
    value = JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new Error("Packaged sidecar identity probe returned invalid JSON.", { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Packaged sidecar identity probe returned an invalid value.");
  }
  const probe = value as Record<string, unknown>;
  if (
    probe.runtimeFlavor !== "node" ||
    typeof probe.platform !== "string" ||
    typeof probe.arch !== "string" ||
    typeof probe.nodeVersion !== "string" ||
    !Number.isSafeInteger(probe.nodeModuleAbi) ||
    !Number.isSafeInteger(probe.napiVersion) ||
    (probe.glibcVersionRuntime !== undefined && typeof probe.glibcVersionRuntime !== "string")
  ) {
    throw new Error("Packaged sidecar identity probe returned an invalid shape.");
  }
  return Object.freeze(probe as unknown as SidecarRuntimeProbe);
}

export async function inspectPackagedRuntime(
  extractionRoot: string,
  options: InspectPackagedRuntimeOptions,
): Promise<PackagedRuntimeLayout> {
  const canonicalRoot = await realpath(extractionRoot);
  if (canonicalRoot !== path.resolve(extractionRoot)) {
    throw new Error("Debian extraction root must be canonical.");
  }
  const files = await walkRegularFiles(canonicalRoot);
  const mainExecutable = uniqueBasename(files, MAIN_EXECUTABLE, "Tauri executable");
  const sidecarExecutable = uniqueBasename(files, SIDECAR_EXECUTABLE, "Runtime sidecar");
  const envelopePath = uniqueBasename(files, TAURI_SIDECAR_ENVELOPE_FILENAME, "sidecar envelope");
  const runtimeRoot = path.dirname(envelopePath);
  const expectedBin = path.join(canonicalRoot, "usr", "bin");
  if (
    path.dirname(mainExecutable) !== expectedBin ||
    path.dirname(sidecarExecutable) !== expectedBin ||
    path.basename(runtimeRoot) !== "runtime" ||
    !isInside(path.join(canonicalRoot, "usr", "lib"), runtimeRoot)
  ) {
    throw new Error("Extracted Debian package does not use the admitted Tauri Linux layout.");
  }
  for (const executable of [mainExecutable, sidecarExecutable]) {
    const executableStats = await lstat(executable);
    if ((executableStats.mode & 0o111) === 0) {
      throw new Error("Packaged executable is not executable.");
    }
  }

  const serializedEnvelope = await readFile(envelopePath, "utf8");
  let envelopeValue: unknown;
  try {
    envelopeValue = JSON.parse(serializedEnvelope) as unknown;
  } catch (error) {
    throw new Error("Packaged sidecar envelope is invalid JSON.", { cause: error });
  }
  const envelope = parseTauriSidecarEnvelope(envelopeValue);
  if (!envelope || serializeTauriSidecarEnvelope(envelope) !== serializedEnvelope) {
    throw new Error("Packaged sidecar envelope is invalid or non-canonical.");
  }
  if (
    envelope.target.platform !== "linux" ||
    options.packageMetadata.architecture !== expectedDebArchitecture(envelope.target) ||
    process.arch !== envelope.target.arch
  ) {
    throw new Error("Debian package architecture does not match this native Runtime target.");
  }

  const binary = await measureFile(sidecarExecutable);
  if (binary.size !== envelope.nodeBinary.size || binary.sha256 !== envelope.nodeBinary.sha256) {
    throw new Error("Packaged sidecar binary does not match its envelope.");
  }
  const manifestPath = path.join(runtimeRoot, RUNTIME_ARTIFACT_MANIFEST_FILENAME);
  const manifestMeasurement = await measureFile(manifestPath);
  if (
    manifestMeasurement.size !== envelope.sourceManifest.size ||
    manifestMeasurement.sha256 !== envelope.sourceManifest.sha256
  ) {
    throw new Error("Packaged Runtime manifest does not match its envelope.");
  }
  const manifest = parseRuntimeArtifactManifest(
    JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
  );
  if (!manifest || !exactJson(manifest.target, envelope.target)) {
    throw new Error("Packaged Runtime manifest target does not match its envelope.");
  }
  for (const [actual, expected, label] of [
    [manifest.externalPackages, RUNTIME_NODE_ARTIFACT_EXTERNAL_PACKAGES, "external"],
    [manifest.dynamicPackages, RUNTIME_NODE_ARTIFACT_DYNAMIC_PACKAGES, "dynamic"],
    [manifest.nativePackages, RUNTIME_NODE_ARTIFACT_NATIVE_PACKAGES, "native"],
  ] as const) {
    if (!exactJson(actual, expected)) {
      throw new Error(`Packaged Runtime ${label} package inventory is incomplete.`);
    }
  }
  const tree = await digestLinkFreeTree(runtimeRoot, {
    exclude: [TAURI_SIDECAR_ENVELOPE_FILENAME],
  });
  if (!exactJson(tree, envelope.materializedTree)) {
    throw new Error("Packaged Runtime resource tree does not match its envelope.");
  }
  const inventoryPath = path.join(runtimeRoot, ...manifest.nativeInventory.path.split("/"));
  const inventoryMeasurement = await measureFile(inventoryPath);
  if (
    inventoryMeasurement.size !== manifest.nativeInventory.size ||
    inventoryMeasurement.sha256 !== manifest.nativeInventory.sha256
  ) {
    throw new Error("Packaged native inventory does not match the Runtime manifest.");
  }
  const nativeInventory = parseRuntimeArtifactNativeInventory(
    JSON.parse(await readFile(inventoryPath, "utf8")) as unknown,
  );
  if (!nativeInventory) throw new Error("Packaged native inventory is invalid.");
  await verifyNativeInventory(runtimeRoot, nativeInventory, envelope.target);

  const probe = await (options.probeSidecar ?? probePackagedSidecar)(
    sidecarExecutable,
    options.commandRunner ?? runCommand,
  );
  if (
    probe.runtimeFlavor !== envelope.target.runtimeFlavor ||
    probe.platform !== envelope.target.platform ||
    probe.arch !== envelope.target.arch ||
    probe.nodeVersion !== envelope.target.nodeVersion ||
    probe.nodeModuleAbi !== envelope.target.nodeModuleAbi ||
    probe.napiVersion !== envelope.target.napiVersion ||
    (envelope.target.libc === "glibc" && !probe.glibcVersionRuntime) ||
    (envelope.target.libc === "musl" && probe.glibcVersionRuntime !== undefined)
  ) {
    throw new Error("Final packaged sidecar runtime does not match its target/ABI envelope.");
  }
  return Object.freeze({
    extractionRoot: canonicalRoot,
    mainExecutable,
    sidecarExecutable,
    runtimeRoot,
    envelopePath,
    envelope,
    envelopeSha256: createHash("sha256").update(serializedEnvelope).digest("hex"),
    nativeInventory,
  });
}

function parseProcStat(
  serialized: string,
): Omit<LinuxProcessSnapshot, "socketInodes" | "credentialMaterialPresent"> | undefined {
  const open = serialized.indexOf("(");
  const close = serialized.lastIndexOf(")");
  if (open <= 0 || close <= open || serialized[close + 1] !== " ") return undefined;
  const pid = Number(serialized.slice(0, open).trim());
  const fields = serialized
    .slice(close + 2)
    .trim()
    .split(/\s+/u);
  const ppid = Number(fields[1]);
  const processGroupId = Number(fields[2]);
  const sessionId = Number(fields[3]);
  const ttyNumber = Number(fields[4]);
  const startTimeTicks = fields[19];
  if (
    !Number.isInteger(pid) ||
    pid < 1 ||
    !Number.isInteger(ppid) ||
    ppid < 0 ||
    !Number.isInteger(processGroupId) ||
    processGroupId < 0 ||
    !Number.isInteger(sessionId) ||
    sessionId < 0 ||
    !Number.isInteger(ttyNumber) ||
    !/^\d+$/u.test(startTimeTicks ?? "")
  ) {
    return undefined;
  }
  return { pid, ppid, processGroupId, sessionId, ttyNumber, startTimeTicks };
}

async function optionalReadlink(value: string): Promise<string | undefined> {
  try {
    return await readlink(value);
  } catch {
    return undefined;
  }
}

async function socketInodesForProcess(procDirectory: string): Promise<readonly string[]> {
  const result = new Set<string>();
  try {
    for (const name of await readdir(path.join(procDirectory, "fd"))) {
      const target = await optionalReadlink(path.join(procDirectory, "fd", name));
      const match = target?.match(/^socket:\[(\d+)\]$/u);
      if (match) result.add(match[1]);
    }
  } catch {}
  return Object.freeze([...result].sort());
}

export async function readLinuxProcessCensus(
  procRoot = "/proc",
): Promise<ReadonlyMap<number, LinuxProcessSnapshot>> {
  const result = new Map<number, LinuxProcessSnapshot>();
  const entries = await readdir(procRoot, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && /^\d+$/u.test(entry.name))
      .map(async (entry) => {
        const procDirectory = path.join(procRoot, entry.name);
        try {
          const parsed = parseProcStat(await readFile(path.join(procDirectory, "stat"), "utf8"));
          if (!parsed) return;
          const [executable, cwd, stdinTarget, cmdline, environ, socketInodes] = await Promise.all([
            optionalReadlink(path.join(procDirectory, "exe")),
            optionalReadlink(path.join(procDirectory, "cwd")),
            optionalReadlink(path.join(procDirectory, "fd", "0")),
            readFile(path.join(procDirectory, "cmdline")).catch(() => Buffer.alloc(0)),
            readFile(path.join(procDirectory, "environ")).catch(() => Buffer.alloc(0)),
            socketInodesForProcess(procDirectory),
          ]);
          const after = parseProcStat(await readFile(path.join(procDirectory, "stat"), "utf8"));
          if (!after || !exactJson(after, parsed)) return;
          const sensitiveSurface = `${cmdline.toString("utf8").replaceAll("\0", "\n")}\n${environ
            .toString("utf8")
            .replaceAll("\0", "\n")}`;
          result.set(
            parsed.pid,
            Object.freeze({
              ...parsed,
              executable,
              cwd,
              stdinTarget,
              socketInodes,
              credentialMaterialPresent: CREDENTIAL_MATERIAL_PATTERN.test(sensitiveSurface),
            }),
          );
        } catch {}
      }),
  );
  return result;
}

export function sameLinuxProcess(
  census: ReadonlyMap<number, LinuxProcessSnapshot>,
  identity: LinuxProcessIdentity,
): boolean {
  return census.get(identity.pid)?.startTimeTicks === identity.startTimeTicks;
}

export function processDescendsFrom(
  census: ReadonlyMap<number, LinuxProcessSnapshot>,
  candidatePid: number,
  ancestorPid: number,
): boolean {
  const visited = new Set<number>();
  let pid = candidatePid;
  while (pid > 0 && !visited.has(pid)) {
    if (pid === ancestorPid) return true;
    visited.add(pid);
    const process = census.get(pid);
    if (!process) return false;
    const parent = census.get(process.ppid);
    if (parent && BigInt(parent.startTimeTicks) > BigInt(process.startTimeTicks)) return false;
    pid = process.ppid;
  }
  return false;
}

export function processesReferencingRoots(
  census: ReadonlyMap<number, LinuxProcessSnapshot>,
  roots: readonly string[],
): readonly LinuxProcessSnapshot[] {
  return [...census.values()].filter((process) =>
    [process.executable, process.cwd].some(
      (value) => value && roots.some((root) => isInside(root, value)),
    ),
  );
}

export function discoverOwnedPackagedProcesses(
  census: ReadonlyMap<number, LinuxProcessSnapshot>,
  {
    ownerPid,
    mainExecutable,
    sidecarExecutable,
  }: {
    readonly ownerPid: number;
    readonly mainExecutable: string;
    readonly sidecarExecutable: string;
  },
): OwnedPackagedProcessTopology {
  const owned = [...census.values()]
    .filter((process) => processDescendsFrom(census, process.pid, ownerPid))
    .sort((left, right) => left.pid - right.pid);
  const unique = (
    candidates: readonly LinuxProcessSnapshot[],
    label: string,
  ): LinuxProcessSnapshot | undefined => {
    if (candidates.length > 1) {
      throw new Error(`Owned packaged process census found duplicate ${label} identities.`);
    }
    return candidates[0];
  };
  const owner = census.get(ownerPid);
  const tauri = unique(
    owner?.executable === mainExecutable
      ? [owner]
      : owned.filter(
          (process) => process.ppid === ownerPid && process.executable === mainExecutable,
        ),
    "Tauri",
  );
  const watchdog = tauri
    ? unique(
        owned.filter(
          (process) =>
            process.pid !== tauri.pid &&
            process.executable === mainExecutable &&
            process.ppid === tauri.pid &&
            process.pid === process.processGroupId,
        ),
        "Runtime watchdog",
      )
    : undefined;
  const host = unique(
    owned.filter(
      (process) =>
        process.executable === sidecarExecutable &&
        (!tauri || processDescendsFrom(census, process.pid, tauri.pid)),
    ),
    "Runtime Host",
  );
  const pty = host
    ? unique(
        owned.filter(
          (process) =>
            process.pid !== host.pid &&
            process.ppid === host.pid &&
            process.pid === process.processGroupId &&
            process.pid === process.sessionId &&
            process.ttyNumber !== 0 &&
            process.stdinTarget?.startsWith("/dev/pts/"),
        ),
        "PTY",
      )
    : undefined;
  return Object.freeze({
    owned: Object.freeze(owned),
    tauri,
    watchdog,
    host,
    pty,
    credentialMaterialPresent: owned.some((process) => process.credentialMaterialPresent),
  });
}

export function linuxExactProcessGroupScope(
  topology: OwnedPackagedProcessTopology,
): LinuxExactProcessGroupScope {
  const { watchdog, host, pty } = topology;
  if (
    !watchdog ||
    !host ||
    watchdog.pid <= 1 ||
    watchdog.pid !== watchdog.processGroupId ||
    host.processGroupId !== watchdog.pid
  ) {
    throw new Error("Owned packaged process census did not prove the Runtime exact-PGID scope.");
  }
  const members = topology.owned.filter(
    (process) => process.processGroupId === watchdog.processGroupId,
  );
  if (!members.some((process) => process.pid === host.pid)) {
    throw new Error("Runtime Host was absent from the watchdog exact process group.");
  }
  return Object.freeze({
    processGroupId: watchdog.processGroupId,
    watchdog,
    host,
    members: Object.freeze(members),
    ptyInsideScope: pty?.processGroupId === watchdog.processGroupId,
  });
}

export function runtimeGenerationIsDrained(
  census: ReadonlyMap<number, LinuxProcessSnapshot>,
  generation: Readonly<{
    watchdog: LinuxProcessSnapshot;
    host: LinuxProcessSnapshot;
    pty?: LinuxProcessSnapshot;
    hostPorts: ReadonlySet<number>;
  }>,
  livePorts: ReadonlySet<number>,
): boolean {
  return (
    ![generation.watchdog, generation.host, generation.pty]
      .filter((process): process is LinuxProcessSnapshot => process !== undefined)
      .some((process) => sameLinuxProcess(census, process)) &&
    ![...census.values()].some(
      (process) => process.processGroupId === generation.watchdog.processGroupId,
    ) &&
    ![...generation.hostPorts].some((port) => livePorts.has(port))
  );
}

export function parseLinuxTcpSocketTable(
  serialized: string,
  inodes: ReadonlySet<string>,
): readonly LinuxTcpSocketSnapshot[] {
  const sockets: LinuxTcpSocketSnapshot[] = [];
  for (const line of serialized.trim().split("\n").slice(1)) {
    const fields = line.trim().split(/\s+/u);
    const inode = fields[9] ?? "";
    const state = fields[3]?.toUpperCase() ?? "";
    if (!inodes.has(inode) || !/^[0-9A-F]{2}$/u.test(state)) continue;
    const localPort = Number.parseInt(fields[1]?.split(":").at(-1) ?? "", 16);
    if (!Number.isInteger(localPort) || localPort <= 0 || localPort > 65_535) continue;
    sockets.push(Object.freeze({ inode, localPort, state }));
  }
  return Object.freeze(sockets);
}

async function tcpSocketsForInodes(
  inodes: ReadonlySet<string>,
  procRoot = "/proc",
): Promise<readonly LinuxTcpSocketSnapshot[]> {
  const sockets: LinuxTcpSocketSnapshot[] = [];
  for (const table of ["tcp", "tcp6"]) {
    let serialized = "";
    try {
      serialized = await readFile(path.join(procRoot, "net", table), "utf8");
    } catch {
      continue;
    }
    sockets.push(...parseLinuxTcpSocketTable(serialized, inodes));
  }
  return Object.freeze(sockets);
}

export function summarizeRuntimeHostNetwork(
  sockets: readonly LinuxTcpSocketSnapshot[],
): Readonly<{ hasEstablishedConnection: boolean; listeningPorts: readonly number[] }> {
  const listeningPorts = Object.freeze(
    [
      ...new Set(
        sockets.filter((socket) => socket.state === "0A").map((socket) => socket.localPort),
      ),
    ].sort((left, right) => left - right),
  );
  return Object.freeze({
    hasEstablishedConnection: sockets.some(
      (socket) => socket.state === "01" && listeningPorts.includes(socket.localPort),
    ),
    listeningPorts,
  });
}

async function runtimeHostNetworkForInodes(
  inodes: ReadonlySet<string>,
  procRoot = "/proc",
): Promise<Readonly<{ hasEstablishedConnection: boolean; listeningPorts: readonly number[] }>> {
  return summarizeRuntimeHostNetwork(await tcpSocketsForInodes(inodes, procRoot));
}

async function listeningPortsForInodes(
  inodes: ReadonlySet<string>,
  procRoot = "/proc",
): Promise<readonly number[]> {
  return (await runtimeHostNetworkForInodes(inodes, procRoot)).listeningPorts;
}

async function readPackageMetadata(
  debPath: string,
  commandRunner: CommandRunner,
): Promise<DebPackageMetadata> {
  const fields = await Promise.all(
    ["Package", "Version", "Architecture"].map(async (field) =>
      (await commandRunner("dpkg-deb", ["--field", debPath, field])).stdout.trim(),
    ),
  );
  if (fields.some((field) => field.length === 0 || /\s/u.test(field))) {
    throw new Error("Debian package metadata is invalid.");
  }
  return Object.freeze({ packageName: fields[0], version: fields[1], architecture: fields[2] });
}

export async function resolveDebPackage(debPath?: string): Promise<string> {
  if (debPath) {
    const resolved = await realpath(path.resolve(debPath));
    const stats = await lstat(resolved);
    if (!stats.isFile() || !resolved.endsWith(".deb")) {
      throw new Error("--deb must name one regular Debian package.");
    }
    return resolved;
  }
  let names: string[];
  try {
    names = (await readdir(DEFAULT_DEB_DIRECTORY)).filter((name) => name.endsWith(".deb"));
  } catch (error) {
    throw new Error("No Tauri Debian bundle was found; pass --deb with the final package path.", {
      cause: error,
    });
  }
  if (names.length !== 1) {
    throw new Error("The default Tauri bundle directory must contain exactly one Debian package.");
  }
  return realpath(path.join(DEFAULT_DEB_DIRECTORY, names[0]));
}

function captureChild(
  executable: string,
  args: readonly string[],
  options: SpawnOptions,
  spawnProcess: ProcessSpawner,
): CapturedChild {
  const child = spawnProcess(executable, args, options);
  let stdout = "";
  let stderr = "";
  let overflow = false;
  const append = (current: string, chunk: Buffer | string): string => {
    const next = `${current}${String(chunk)}`;
    if (Buffer.byteLength(next) <= MAX_CHILD_OUTPUT_BYTES) return next;
    overflow = true;
    return next.slice(-MAX_CHILD_OUTPUT_BYTES);
  };
  child.stdout?.on("data", (chunk: Buffer | string) => {
    stdout = append(stdout, chunk);
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderr = append(stderr, chunk);
  });
  const exit = new Promise<ExitStatus>((resolve) => {
    child.once("error", () => resolve({ code: null, signal: null }));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return Object.freeze({ child, exit, output: () => ({ stdout, stderr, overflow }) });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = globalThis.setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) globalThis.clearTimeout(timer);
  }
}

async function displayNumber(child: ChildProcess, timeoutMs: number): Promise<string> {
  const descriptor = child.stdio?.[3];
  if (!descriptor || typeof (descriptor as NodeJS.ReadableStream).on !== "function") {
    throw new Error("Xvfb did not expose its display descriptor.");
  }
  return withTimeout(
    new Promise<string>((resolve, reject) => {
      let value = "";
      const readable = descriptor as NodeJS.ReadableStream;
      readable.on("data", (chunk: Buffer | string) => {
        value += String(chunk);
        const newline = value.indexOf("\n");
        if (newline < 0) return;
        const number = value.slice(0, newline).trim();
        if (!/^\d+$/u.test(number)) reject(new Error("Xvfb returned an invalid display number."));
        else resolve(`:${number}`);
      });
      readable.once("error", reject);
    }),
    timeoutMs,
    "Xvfb display allocation",
  );
}

async function startDisplay(
  stateRoot: string,
  environment: NodeJS.ProcessEnv,
  commandRunner: CommandRunner,
  spawnProcess: ProcessSpawner,
  delay: (milliseconds: number) => Promise<void>,
  timeoutMs: number,
): Promise<DisplayOwner> {
  const xvfb = captureChild(
    "Xvfb",
    ["-displayfd", "3", "-screen", "0", "1280x800x24", "-nolisten", "tcp", "-noreset"],
    { cwd: stateRoot, detached: true, env: environment, stdio: ["ignore", "pipe", "pipe", "pipe"] },
    spawnProcess,
  );
  let windowManager: CapturedChild | undefined;
  try {
    const display = await displayNumber(xvfb.child, Math.min(timeoutMs, 10_000));
    const displayEnvironment = { ...environment, DISPLAY: display };
    for (const started = Date.now(); ;) {
      try {
        await commandRunner("xdpyinfo", [], { env: displayEnvironment, timeoutMs: 2_000 });
        break;
      } catch {
        if (Date.now() - started >= Math.min(timeoutMs, 10_000)) {
          throw new Error("Xvfb did not become ready.");
        }
        await delay(50);
      }
    }
    windowManager = captureChild(
      LINUX_WINDOW_MANAGER_SESSION_COMMAND.executable,
      LINUX_WINDOW_MANAGER_SESSION_COMMAND.args,
      {
        cwd: stateRoot,
        detached: true,
        env: displayEnvironment,
        stdio: ["ignore", "pipe", "pipe"],
      },
      spawnProcess,
    );
    for (const started = Date.now(); ;) {
      try {
        const { stdout } = await commandRunner("xprop", ["-root", "_NET_SUPPORTING_WM_CHECK"], {
          env: displayEnvironment,
          timeoutMs: 2_000,
        });
        if (!/not found/iu.test(stdout)) break;
      } catch {}
      if (Date.now() - started >= Math.min(timeoutMs, 10_000)) {
        throw new Error("The isolated X11 window manager did not become ready.");
      }
      await delay(50);
    }
    return Object.freeze({ display, xvfb, windowManager });
  } catch (error) {
    await stopCapturedChild(windowManager, 5_000);
    await stopCapturedChild(xvfb, 5_000);
    throw error;
  }
}

async function listManagedWindows(
  pid: number,
  environment: NodeJS.ProcessEnv,
  commandRunner: CommandRunner,
): Promise<readonly ManagedWindow[]> {
  let stdout = "";
  try {
    stdout = (await commandRunner("wmctrl", ["-lp"], { env: environment, timeoutMs: 2_000 }))
      .stdout;
  } catch {
    return [];
  }
  const windows: ManagedWindow[] = [];
  for (const line of stdout.split("\n")) {
    const window = parseManagedWindowLine(line);
    if (window?.pid === pid) windows.push(window);
  }
  return Object.freeze(windows);
}

function productWindowFromManaged(windows: readonly ManagedWindow[]): ProductWindow | undefined {
  const productWindows = windows.filter((window) => window.title === PRODUCT_WINDOW_TITLE);
  if (windows.length > 1 || productWindows.length > 1) {
    throw new Error("Packaged Pi Workbench opened more than one managed application window.");
  }
  const productWindow = productWindows[0];
  return productWindow
    ? Object.freeze({ id: productWindow.id, title: PRODUCT_WINDOW_TITLE })
    : undefined;
}

async function focusProductWindow(
  window: ProductWindow,
  environment: NodeJS.ProcessEnv,
  commandRunner: CommandRunner,
): Promise<void> {
  await commandRunner("xdotool", ["windowactivate", "--sync", window.id], {
    env: environment,
    timeoutMs: 5_000,
  });
  const activeWindow = Number(
    (
      await commandRunner("xdotool", ["getactivewindow"], {
        env: environment,
        timeoutMs: 2_000,
      })
    ).stdout.trim(),
  );
  if (activeWindow !== Number.parseInt(window.id.slice(2), 16)) {
    throw new Error("Pi Workbench did not retain focus for product renderer interaction.");
  }
}

export async function prepareProductWindowForCommandPalette(
  window: ProductWindow,
  environment: NodeJS.ProcessEnv,
  commandRunner: CommandRunner,
): Promise<void> {
  await focusProductWindow(window, environment, commandRunner);
  await commandRunner("xdotool", ["key", "--clearmodifiers", "Escape"], {
    env: environment,
    timeoutMs: 2_000,
  });
  const geometry = (
    await commandRunner("xdotool", ["getwindowgeometry", "--shell", window.id], {
      env: environment,
      timeoutMs: 2_000,
    })
  ).stdout;
  const width = Number(/^WIDTH=(\d+)$/mu.exec(geometry)?.[1]);
  const height = Number(/^HEIGHT=(\d+)$/mu.exec(geometry)?.[1]);
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new Error("Pi Workbench returned invalid product window geometry.");
  }
  await commandRunner(
    "xdotool",
    [
      "mousemove",
      "--window",
      window.id,
      String(Math.floor(width / 2)),
      String(Math.min(20, height - 1)),
    ],
    { env: environment, timeoutMs: 2_000 },
  );
  await commandRunner("xdotool", ["click", "--clearmodifiers", "1"], {
    env: environment,
    timeoutMs: 2_000,
  });
  await focusProductWindow(window, environment, commandRunner);
}

async function pasteAndSubmitClipboardText(
  value: string,
  stateRoot: string,
  environment: NodeJS.ProcessEnv,
  commandRunner: CommandRunner,
  spawnProcess: ProcessSpawner,
  delay: (milliseconds: number) => Promise<void>,
): Promise<void> {
  const clipboard = captureChild(
    "xclip",
    ["-selection", "clipboard", "-in", "-quiet"],
    {
      cwd: stateRoot,
      detached: true,
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
    },
    spawnProcess,
  );
  try {
    const stdin = clipboard.child.stdin;
    if (!stdin) throw new Error("xclip did not expose its input stream.");
    stdin.on("error", () => undefined);
    stdin.end(value);
    await delay(75);
    if (clipboard.child.exitCode !== null || clipboard.child.signalCode !== null) {
      throw new Error("xclip exited before the localized command title was pasted.");
    }
    await commandRunner("xdotool", ["key", "--clearmodifiers", "ctrl+a"], {
      env: environment,
      timeoutMs: 2_000,
    });
    await commandRunner("xdotool", ["key", "--clearmodifiers", "ctrl+v"], {
      env: environment,
      timeoutMs: 2_000,
    });
    await delay(150);
    await commandRunner("xdotool", ["key", "--clearmodifiers", "Return"], {
      env: environment,
      timeoutMs: 2_000,
    });
    await delay(75);
  } finally {
    await stopCapturedChild(clipboard, 2_000);
  }
}

async function selectCommandPaletteCommand(
  window: ProductWindow,
  commandTitle: string,
  stateRoot: string,
  environment: NodeJS.ProcessEnv,
  commandRunner: CommandRunner,
  spawnProcess: ProcessSpawner,
  delay: (milliseconds: number) => Promise<void>,
): Promise<void> {
  await prepareProductWindowForCommandPalette(window, environment, commandRunner);
  await commandRunner("xdotool", ["key", "--clearmodifiers", "ctrl+k"], {
    env: environment,
    timeoutMs: 2_000,
  });
  await delay(250);
  await pasteAndSubmitClipboardText(
    commandTitle,
    stateRoot,
    environment,
    commandRunner,
    spawnProcess,
    delay,
  );
}

function safeEnvironment(stateRoot: string, display: string): NodeJS.ProcessEnv {
  const home = path.join(stateRoot, "home");
  return {
    DISPLAY: display,
    GSETTINGS_BACKEND: "memory",
    HOME: home,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    LOGNAME: process.env.LOGNAME ?? process.env.USER ?? "workbench-smoke",
    NO_AT_BRIDGE: "1",
    PATH: process.env.PATH,
    SHELL: process.env.SHELL ?? "/bin/sh",
    TMPDIR: path.join(stateRoot, "tmp"),
    USER: process.env.USER ?? "workbench-smoke",
    WEBKIT_DISABLE_COMPOSITING_MODE: "1",
    XDG_CACHE_HOME: path.join(stateRoot, "xdg-cache"),
    XDG_CONFIG_HOME: path.join(stateRoot, "xdg-config"),
    XDG_DATA_HOME: path.join(stateRoot, "xdg-data"),
    XDG_RUNTIME_DIR: path.join(stateRoot, "xdg-runtime"),
    XDG_STATE_HOME: path.join(stateRoot, "xdg-state"),
  };
}

async function createStateDirectories(stateRoot: string): Promise<void> {
  const directories = [
    "home",
    "tmp",
    "xdg-cache",
    "xdg-config",
    "xdg-data",
    "xdg-runtime",
    "xdg-state",
  ];
  for (const directory of directories) {
    const absolute = path.join(stateRoot, directory);
    await mkdir(absolute, { recursive: true, mode: 0o700 });
    await chmod(absolute, 0o700);
  }
}

async function stopCapturedChild(
  captured: CapturedChild | undefined,
  timeoutMs: number,
): Promise<void> {
  if (
    !captured?.child.pid ||
    captured.child.exitCode !== null ||
    captured.child.signalCode !== null
  )
    return;
  try {
    process.kill(-captured.child.pid, "SIGTERM");
  } catch {}
  try {
    await withTimeout(captured.exit, timeoutMs, "owned helper shutdown");
    return;
  } catch {}
  try {
    process.kill(-captured.child.pid, "SIGKILL");
  } catch {}
  await withTimeout(captured.exit, timeoutMs, "owned helper forced shutdown").catch(
    () => undefined,
  );
}

export async function stopOwnedDisplay<Child>(
  display: Readonly<{ windowManager: Child; xvfb: Child }> | undefined,
  stopChild: (child: Child) => Promise<void>,
): Promise<undefined> {
  if (display) {
    await stopChild(display.windowManager);
    await stopChild(display.xvfb);
  }
  return undefined;
}

async function cleanupExactProcesses(
  identities: readonly LinuxProcessSnapshot[],
  readCensus: () => Promise<ReadonlyMap<number, LinuxProcessSnapshot>>,
): Promise<void> {
  const census = await readCensus().catch(() => new Map<number, LinuxProcessSnapshot>());
  const live = identities.filter((identity) => sameLinuxProcess(census, identity));
  live.sort((left, right) => right.pid - left.pid);
  for (const identity of live) {
    try {
      process.kill(identity.pid, "SIGKILL");
    } catch {}
  }
}

function publicIdentity(process: LinuxProcessSnapshot): Readonly<Record<string, unknown>> {
  return Object.freeze({
    pid: process.pid,
    startTimeTicks: process.startTimeTicks,
    ppid: process.ppid,
    processGroupId: process.processGroupId,
    sessionId: process.sessionId,
    ttyNumber: process.ttyNumber,
    executable: process.executable ? path.basename(process.executable) : undefined,
    stdin: process.stdinTarget?.startsWith("/dev/pts/") ? "pty" : undefined,
  });
}

async function waitForCleanShutdown(
  observed: ObservedTopology,
  roots: readonly string[],
  readCensus: () => Promise<ReadonlyMap<number, LinuxProcessSnapshot>>,
  delay: (milliseconds: number) => Promise<void>,
  timeoutMs: number,
): Promise<void> {
  for (const started = Date.now(); ;) {
    const census = await readCensus();
    const trackedLive = [...observed.tracked.values()].filter((identity) =>
      sameLinuxProcess(census, identity),
    );
    const referenced = processesReferencingRoots(census, roots);
    const livePorts = new Set(
      await listeningPortsForInodes(
        new Set([...census.values()].flatMap((process) => process.socketInodes)),
      ),
    );
    const retainedPorts = [...observed.hostPorts].filter((port) => livePorts.has(port));
    if (trackedLive.length === 0 && referenced.length === 0 && retainedPorts.length === 0) return;
    if (Date.now() - started >= timeoutMs) {
      throw new Error("Packaged application left a tracked process, package reference, or port.");
    }
    await delay(50);
  }
}

async function waitForProcessIdentity(
  pid: number,
  readCensus: () => Promise<ReadonlyMap<number, LinuxProcessSnapshot>>,
  delay: (milliseconds: number) => Promise<void>,
  timeoutMs: number,
  label: string,
): Promise<LinuxProcessSnapshot> {
  for (const started = Date.now(); ;) {
    const identity = (await readCensus()).get(pid);
    if (identity) return identity;
    if (Date.now() - started >= timeoutMs) {
      throw new Error(`${label} did not become observable in the Linux process census.`);
    }
    await delay(20);
  }
}

interface HardDeathProof {
  readonly ptySurvivedUntilHarnessCleanup: boolean;
}

async function waitForHardDeathContainment(
  tauri: LinuxProcessSnapshot,
  scope: LinuxExactProcessGroupScope,
  pty: LinuxProcessSnapshot,
  decoy: LinuxProcessSnapshot,
  hostPorts: ReadonlySet<number>,
  readCensus: () => Promise<ReadonlyMap<number, LinuxProcessSnapshot>>,
  delay: (milliseconds: number) => Promise<void>,
  timeoutMs: number,
): Promise<HardDeathProof> {
  for (const started = Date.now(); ;) {
    const census = await readCensus();
    if (!sameLinuxProcess(census, decoy)) {
      throw new Error("Exact-PGID parent-death cleanup signaled the unrelated decoy.");
    }
    const tauriLive = sameLinuxProcess(census, tauri);
    const exactScopeLive = [...census.values()].filter(
      (process) => process.processGroupId === scope.processGroupId,
    );
    const livePorts = new Set(
      await listeningPortsForInodes(
        new Set([...census.values()].flatMap((process) => process.socketInodes)),
      ),
    );
    const retainedPorts = [...hostPorts].filter((port) => livePorts.has(port));
    if (!tauriLive && exactScopeLive.length === 0 && retainedPorts.length === 0) {
      return Object.freeze({
        ptySurvivedUntilHarnessCleanup: sameLinuxProcess(census, pty),
      });
    }
    if (Date.now() - started >= timeoutMs) {
      throw new Error("Packaged watchdog did not empty its exact PGID and Runtime ports.");
    }
    await delay(20);
  }
}

async function removeIsolatedState(
  temporaryRoot: string,
  delay: (milliseconds: number) => Promise<void>,
  timeoutMs = 5_000,
): Promise<void> {
  for (const started = Date.now(); ;) {
    try {
      await rm(temporaryRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code !== "EBUSY" && code !== "ENOTEMPTY") || Date.now() - started >= timeoutMs) {
        throw new Error("Isolated packaged smoke state could not be removed.");
      }
      await delay(50);
    }
  }
}

export async function runLinuxPackagedProductSmoke(
  options: LinuxPackagedProductSmokeOptions = {},
): Promise<Readonly<Record<string, unknown>>> {
  if (process.platform !== "linux") {
    throw new Error("The packaged product execution smoke is a Linux-native gate.");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const commandRunner = options.commandRunner ?? runCommand;
  const spawnProcess = options.spawnProcess ?? spawn;
  const readCensus = options.readProcessCensus ?? readLinuxProcessCensus;
  const delay = options.delay ?? sleep;
  const debPath = await resolveDebPackage(options.debPath);
  const packageMetadata = await readPackageMetadata(debPath, commandRunner);
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "workbench-tauri-packaged-smoke-"));
  const extractionRoot = path.join(temporaryRoot, "extracted");
  const stateRoot = path.join(temporaryRoot, "state");
  await mkdir(extractionRoot, { mode: 0o700 });
  await mkdir(stateRoot, { mode: 0o700 });
  await createStateDirectories(stateRoot);

  let display: DisplayOwner | undefined;
  let application: CapturedChild | undefined;
  let decoy: CapturedChild | undefined;
  let decoyIdentity: LinuxProcessSnapshot | undefined;
  const observed: ObservedTopology = {
    tracked: new Map(),
    generations: [],
    hostPorts: new Set(),
    credentialMaterialPresent: false,
  };
  let stopCensus = false;
  let censusTask: Promise<void> | undefined;
  let result: Readonly<Record<string, unknown>> | undefined;
  let primaryFailure: unknown;
  try {
    await commandRunner("dpkg-deb", ["--extract", debPath, extractionRoot], {
      timeoutMs: Math.min(timeoutMs, 30_000),
    });
    const layout = await inspectPackagedRuntime(extractionRoot, {
      packageMetadata,
      commandRunner,
    });
    const baseEnvironment = safeEnvironment(stateRoot, "");
    display = await startDisplay(
      stateRoot,
      baseEnvironment,
      commandRunner,
      spawnProcess,
      delay,
      timeoutMs,
    );
    const environment = safeEnvironment(stateRoot, display.display);
    if (options.shutdownMode === "hard-death") {
      decoy = captureChild(
        "/bin/sleep",
        ["300"],
        {
          cwd: "/",
          detached: true,
          env: { LANG: "C.UTF-8", LC_ALL: "C.UTF-8", PATH: process.env.PATH },
          stdio: ["ignore", "pipe", "pipe"],
        },
        spawnProcess,
      );
      const decoyPid = decoy.child.pid;
      if (!decoyPid) throw new Error("Unrelated hard-death decoy did not publish a PID.");
      decoyIdentity = await waitForProcessIdentity(
        decoyPid,
        () => readCensus(),
        delay,
        5_000,
        "Unrelated hard-death decoy",
      );
      if (
        decoyIdentity.processGroupId !== decoyIdentity.pid ||
        decoyIdentity.sessionId !== decoyIdentity.pid
      ) {
        throw new Error("Unrelated hard-death decoy did not own an isolated process group.");
      }
    }
    application = captureChild(
      "dbus-run-session",
      ["--", layout.mainExecutable],
      {
        cwd: path.dirname(layout.mainExecutable),
        detached: true,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      },
      spawnProcess,
    );
    const applicationOwnerPid = application.child.pid;
    if (!applicationOwnerPid)
      throw new Error("Packaged application session did not publish a PID.");
    const mainCanonical = await realpath(layout.mainExecutable);
    const sidecarCanonical = await realpath(layout.sidecarExecutable);
    const captureCensus = async (): Promise<void> => {
      const census = await readCensus();
      let current: OwnedPackagedProcessTopology;
      try {
        current = discoverOwnedPackagedProcesses(census, {
          ownerPid: applicationOwnerPid,
          mainExecutable: mainCanonical,
          sidecarExecutable: sidecarCanonical,
        });
      } catch (error) {
        const duplicateLabel =
          error instanceof Error
            ? error.message.match(
                /^Owned packaged process census found duplicate (Tauri|Runtime watchdog|Runtime Host|PTY) identities\.$/u,
              )?.[1]
            : undefined;
        observed.topologyFailure = duplicateLabel
          ? `Owned packaged process topology became ambiguous: duplicate ${duplicateLabel}.`
          : "Owned packaged process topology became ambiguous.";
        return;
      }
      for (const process of current.owned) {
        observed.tracked.set(identityKey(process), process);
      }
      observed.credentialMaterialPresent ||= current.credentialMaterialPresent;
      if (
        observed.tauri &&
        current.tauri &&
        identityKey(observed.tauri) !== identityKey(current.tauri)
      ) {
        observed.topologyFailure = "Owned Tauri identity changed during one packaged run.";
        return;
      }
      observed.tauri ??= current.tauri;

      if (options.shutdownMode === "hard-death") {
        for (const [label, previous, next] of [
          ["Runtime watchdog", observed.watchdog, current.watchdog],
          ["Runtime Host", observed.host, current.host],
          ["PTY", observed.pty, current.pty],
        ] as const) {
          if (previous && next && identityKey(previous) !== identityKey(next)) {
            observed.topologyFailure = `Owned ${label} identity changed during one generation.`;
            return;
          }
        }
        observed.watchdog ??= current.watchdog;
        observed.host ??= current.host;
        observed.pty ??= current.pty;
      }

      if (!current.watchdog || !current.host) return;
      const watchdogKey = identityKey(current.watchdog);
      const hostKey = identityKey(current.host);
      let generationIndex = observed.generations.findIndex(
        (generation) =>
          identityKey(generation.watchdog) === watchdogKey &&
          identityKey(generation.host) === hostKey,
      );
      if (generationIndex < 0) {
        if (
          observed.generations.some(
            (generation) =>
              (identityKey(generation.watchdog) === watchdogKey) !==
              (identityKey(generation.host) === hostKey),
          )
        ) {
          observed.topologyFailure = "Packaged Runtime generation mixed old and new identities.";
          return;
        }
        const maximumGenerations = options.shutdownMode === "hard-death" ? 1 : 2;
        if (observed.generations.length >= maximumGenerations) {
          observed.topologyFailure = "Packaged product created an unexpected Runtime generation.";
          return;
        }
        generationIndex =
          observed.generations.push({
            watchdog: current.watchdog,
            host: current.host,
            hostPorts: new Set(),
          }) - 1;
      }
      const generation = observed.generations[generationIndex];
      if (
        generation.pty &&
        current.pty &&
        identityKey(generation.pty) !== identityKey(current.pty)
      ) {
        observed.topologyFailure = "Owned PTY identity changed during one generation.";
        return;
      }
      generation.pty ??= current.pty;
      const ports = await listeningPortsForInodes(new Set(current.host.socketInodes));
      for (const port of ports) {
        generation.hostPorts.add(port);
        observed.hostPorts.add(port);
      }
    };
    censusTask = (async () => {
      while (!stopCensus) {
        await captureCensus().catch(() => undefined);
        await delay(CENSUS_INTERVAL_MS);
      }
    })();
    await captureCensus();

    let productWindow: ProductWindow | undefined;
    let readyTopology: OwnedPackagedProcessTopology | undefined;
    for (const started = Date.now(); ;) {
      if (observed.topologyFailure) throw new Error(observed.topologyFailure);
      if (application.child.exitCode !== null || application.child.signalCode !== null) {
        throw new Error("Packaged Pi Workbench exited before its product renderer was ready.");
      }
      if (observed.tauri) {
        const windows = await listManagedWindows(observed.tauri.pid, environment, commandRunner);
        productWindow = productWindowFromManaged(windows);
      }
      if (productWindow) {
        const census = await readCensus();
        const current = discoverOwnedPackagedProcesses(census, {
          ownerPid: applicationOwnerPid,
          mainExecutable: mainCanonical,
          sidecarExecutable: sidecarCanonical,
        });
        if (current.pty) {
          throw new Error("Pi Workbench created a PTY before the terminal.toggle UI command.");
        }
        if (current.tauri && current.watchdog && current.host) {
          const network = await runtimeHostNetworkForInodes(new Set(current.host.socketInodes));
          if (network.listeningPorts.length > 0 && network.hasEstablishedConnection) {
            readyTopology = current;
            for (const port of network.listeningPorts) observed.hostPorts.add(port);
            break;
          }
        }
      }
      if (Date.now() - started >= timeoutMs) {
        throw new Error(
          "Pi Workbench did not expose one product window with a live Runtime Host listener.",
        );
      }
      await delay(50);
    }
    if (!productWindow || !readyTopology?.tauri || !readyTopology.watchdog || !readyTopology.host) {
      throw new Error("Product renderer readiness did not retain its exact process identities.");
    }
    // The first authenticated Host connection can precede the WebKit paint that installs commands.
    await delay(2_000);
    await captureCensus();

    let runtimeRestart:
      | Readonly<{
          commandLocale: string;
          commandTitle: string;
          oldPort: number;
          newPort: number;
          generations: 2;
          oldGenerationDrained: true;
        }>
      | undefined;
    if (options.shutdownMode !== "hard-death") {
      const firstTopology = Object.freeze({
        ...readyTopology,
        tauri: readyTopology.tauri,
        watchdog: readyTopology.watchdog,
        host: readyTopology.host,
      });
      const firstWindow = productWindow;
      const firstPorts = await listeningPortsForInodes(new Set(firstTopology.host.socketInodes));
      const [firstPort] = firstPorts;
      if (!firstPort) throw new Error("The first Runtime generation listener disappeared.");
      const firstGeneration = Object.freeze({
        watchdog: firstTopology.watchdog,
        host: firstTopology.host,
        pty: firstTopology.pty,
        hostPorts: new Set(firstPorts),
      });
      const restartAttemptTimeoutMs = Math.min(timeoutMs, 20_000);
      for (const command of PRODUCT_RUNTIME_RESTART_COMMAND_TITLES) {
        await selectCommandPaletteCommand(
          firstWindow,
          command.title,
          stateRoot,
          environment,
          commandRunner,
          spawnProcess,
          delay,
        );
        const attemptDeadline = Date.now() + restartAttemptTimeoutMs;
        for (;;) {
          if (observed.topologyFailure) throw new Error(observed.topologyFailure);
          if (application.child.exitCode !== null || application.child.signalCode !== null) {
            throw new Error("Packaged Pi Workbench exited during Runtime restart.");
          }
          const windows = await listManagedWindows(
            firstTopology.tauri.pid,
            environment,
            commandRunner,
          );
          const currentWindow = productWindowFromManaged(windows);
          const census = await readCensus();
          const current = discoverOwnedPackagedProcesses(census, {
            ownerPid: applicationOwnerPid,
            mainExecutable: mainCanonical,
            sidecarExecutable: sidecarCanonical,
          });
          const livePorts = new Set(
            await listeningPortsForInodes(
              new Set([...census.values()].flatMap((process) => process.socketInodes)),
            ),
          );
          if (
            currentWindow?.id === firstWindow.id &&
            current.tauri &&
            current.watchdog &&
            current.host &&
            identityKey(current.watchdog) !== identityKey(firstTopology.watchdog) &&
            identityKey(current.host) !== identityKey(firstTopology.host) &&
            runtimeGenerationIsDrained(census, firstGeneration, livePorts)
          ) {
            const newNetwork = await runtimeHostNetworkForInodes(
              new Set(current.host.socketInodes),
            );
            const [newPort] = newNetwork.listeningPorts;
            if (newPort && newNetwork.hasEstablishedConnection) {
              productWindow = currentWindow;
              readyTopology = current;
              runtimeRestart = Object.freeze({
                commandLocale: command.locale,
                commandTitle: command.title,
                oldPort: firstPort,
                newPort,
                generations: 2,
                oldGenerationDrained: true,
              });
              for (const port of newNetwork.listeningPorts) observed.hostPorts.add(port);
              break;
            }
          }
          if (Date.now() >= attemptDeadline) break;
          await delay(50);
        }
        if (runtimeRestart) break;
      }
      if (!runtimeRestart) {
        throw new Error(
          "The localized desktop.runtime.restart command did not replace and drain the Runtime generation.",
        );
      }
      await captureCensus();
    }

    const terminalTauri = readyTopology.tauri;
    if (!terminalTauri) {
      throw new Error("Runtime restart did not retain the packaged Tauri identity.");
    }
    let selectedCommand: (typeof PRODUCT_TERMINAL_TOGGLE_COMMAND_TITLES)[number] | undefined;
    let activeTopology: OwnedPackagedProcessTopology | undefined;
    let activeScope: LinuxExactProcessGroupScope | undefined;
    let activeHostPorts: readonly number[] = [];
    for (const command of [
      ...PRODUCT_TERMINAL_TOGGLE_COMMAND_TITLES,
      ...PRODUCT_TERMINAL_TOGGLE_COMMAND_TITLES,
    ]) {
      await selectCommandPaletteCommand(
        productWindow,
        command.title,
        stateRoot,
        environment,
        commandRunner,
        spawnProcess,
        delay,
      );
      for (const started = Date.now(); ;) {
        if (observed.topologyFailure) throw new Error(observed.topologyFailure);
        if (application.child.exitCode !== null || application.child.signalCode !== null) {
          throw new Error("Packaged Pi Workbench exited during command-palette interaction.");
        }
        const windows = await listManagedWindows(terminalTauri.pid, environment, commandRunner);
        const currentWindow = productWindowFromManaged(windows);
        if (!currentWindow || currentWindow.id !== productWindow.id) {
          throw new Error(
            "Pi Workbench product window changed during command-palette interaction.",
          );
        }
        const census = await readCensus();
        const current = discoverOwnedPackagedProcesses(census, {
          ownerPid: applicationOwnerPid,
          mainExecutable: mainCanonical,
          sidecarExecutable: sidecarCanonical,
        });
        if (current.tauri && identityKey(current.tauri) !== identityKey(terminalTauri)) {
          throw new Error("Owned Tauri identity changed before the terminal interaction.");
        }
        if (current.tauri && current.watchdog && current.host && current.pty) {
          const ports = await listeningPortsForInodes(new Set(current.host.socketInodes));
          if (ports.length > 0) {
            activeTopology = current;
            activeScope = linuxExactProcessGroupScope(current);
            activeHostPorts = ports;
            selectedCommand = command;
            break;
          }
        }
        if (Date.now() - started >= Math.min(timeoutMs, 5_000)) break;
        await delay(50);
      }
      if (activeTopology) break;
    }
    if (
      !selectedCommand ||
      !activeTopology?.tauri ||
      !activeTopology.watchdog ||
      !activeTopology.host ||
      !activeTopology.pty ||
      !activeScope ||
      activeHostPorts.length === 0
    ) {
      throw new Error(
        "The localized terminal.toggle command did not create a live Runtime Host PTY.",
      );
    }
    for (const ownedProcess of activeTopology.owned) {
      observed.tracked.set(identityKey(ownedProcess), ownedProcess);
    }
    observed.tauri ??= activeTopology.tauri;
    observed.watchdog ??= activeTopology.watchdog;
    observed.host ??= activeTopology.host;
    observed.pty ??= activeTopology.pty;
    for (const port of activeHostPorts) observed.hostPorts.add(port);
    await captureCensus();
    const expectedGenerationCount = options.shutdownMode === "hard-death" ? 1 : 2;
    const generation = observed.generations.at(-1);
    if (
      observed.generations.length !== expectedGenerationCount ||
      !generation?.pty ||
      generation.hostPorts.size === 0 ||
      identityKey(generation.watchdog) !== identityKey(activeTopology.watchdog) ||
      identityKey(generation.host) !== identityKey(activeTopology.host) ||
      identityKey(generation.pty) !== identityKey(activeTopology.pty)
    ) {
      throw new Error("Process census did not prove one complete product Runtime generation.");
    }
    if (observed.credentialMaterialPresent) {
      throw new Error(
        "Packaged process argv or environment contained Runtime credential material.",
      );
    }

    let shutdown: Readonly<Record<string, unknown>>;
    if (options.shutdownMode === "hard-death") {
      if (!decoyIdentity) {
        throw new Error("Hard-death identities were not captured at the live PTY boundary.");
      }

      const beforeKill = await readCensus();
      const current = discoverOwnedPackagedProcesses(beforeKill, {
        ownerPid: applicationOwnerPid,
        mainExecutable: mainCanonical,
        sidecarExecutable: sidecarCanonical,
      });
      const scope = linuxExactProcessGroupScope(current);
      if (
        !current.tauri ||
        !current.pty ||
        identityKey(current.tauri) !== identityKey(activeTopology.tauri) ||
        identityKey(scope.watchdog) !== identityKey(activeScope.watchdog) ||
        identityKey(scope.host) !== identityKey(activeScope.host) ||
        identityKey(current.pty) !== identityKey(activeTopology.pty) ||
        !sameLinuxProcess(beforeKill, decoyIdentity)
      ) {
        throw new Error("Packaged process identities changed before the hard-death signal.");
      }
      for (const process of current.owned) {
        observed.tracked.set(identityKey(process), process);
      }

      const proof = waitForHardDeathContainment(
        current.tauri,
        scope,
        current.pty,
        decoyIdentity,
        observed.hostPorts,
        () => readCensus(),
        delay,
        15_000,
      );
      process.kill(current.tauri.pid, "SIGKILL");
      const [applicationExit, hardDeath] = await Promise.all([
        withTimeout(application.exit, 30_000, "packaged hard-death session shutdown"),
        proof,
      ]);
      if (applicationExit.code === null || applicationExit.signal !== null) {
        throw new Error("Owned D-Bus session did not reap the hard-killed Tauri child.");
      }
      stopCensus = true;
      await censusTask;
      await cleanupExactProcesses([...observed.tracked.values()], () => readCensus());
      display = await stopOwnedDisplay(display, (child) => stopCapturedChild(child, 5_000));
      await waitForCleanShutdown(
        observed,
        [layout.extractionRoot, stateRoot],
        () => readCensus(),
        delay,
        15_000,
      );
      shutdown = Object.freeze({
        mode: "hard-death",
        tauriSignal: "SIGKILL",
        sessionExitCode: applicationExit.code,
        containmentScope: "exact-pgid",
        exactProcessGroupId: scope.processGroupId,
        exactMembers: Object.freeze(scope.members.map(publicIdentity)),
        exactScopeResidualProcesses: 0,
        retainedHostPorts: 0,
        decoy: publicIdentity(decoyIdentity),
        decoySurvived: true,
        ptyInsideExactScope: scope.ptyInsideScope,
        ptySurvivedUntilHarnessCleanup: hardDeath.ptySurvivedUntilHarnessCleanup,
        escapedDescendants: "not-covered",
      });
    } else {
      await commandRunner("wmctrl", ["-ic", productWindow.id], {
        env: environment,
        timeoutMs: 5_000,
      });
      const applicationExit = await withTimeout(application.exit, 30_000, "packaged shutdown");
      if (applicationExit.code !== 0 || applicationExit.signal !== null) {
        throw new Error("Packaged application did not exit cleanly after its window closed.");
      }
      stopCensus = true;
      await censusTask;
      display = await stopOwnedDisplay(display, (child) => stopCapturedChild(child, 5_000));
      await waitForCleanShutdown(
        observed,
        [layout.extractionRoot, stateRoot],
        () => readCensus(),
        delay,
        15_000,
      );
      shutdown = Object.freeze({
        mode: "graceful",
        exitCode: applicationExit.code,
        residualProcesses: 0,
      });
    }
    const output = application.output();
    if (output.overflow)
      throw new Error("Packaged application produced excessive product smoke output.");
    assertNoCredentialMaterial(output.stdout, "Packaged application stdout");
    assertNoCredentialMaterial(output.stderr, "Packaged application stderr");

    const processes = Object.freeze({
      tauri: publicIdentity(activeTopology.tauri),
      watchdog: publicIdentity(activeTopology.watchdog),
      host: publicIdentity(activeTopology.host),
      pty: publicIdentity(activeTopology.pty),
      observedOwnedCount: observed.tracked.size,
      runtimeGenerations: expectedGenerationCount,
      hostPorts: Object.freeze([...observed.hostPorts].sort((left, right) => left - right)),
    });
    result = Object.freeze({
      type: RESULT_TYPE,
      package: Object.freeze({
        name: packageMetadata.packageName,
        version: packageMetadata.version,
        architecture: packageMetadata.architecture,
        filename: path.basename(debPath),
      }),
      target: layout.envelope.target,
      envelope: Object.freeze({
        sha256: layout.envelopeSha256,
        runtimeTreeSha256: layout.envelope.materializedTree.sha256,
        nativeFileCount: layout.nativeInventory.files.length,
      }),
      renderer: Object.freeze({
        windowTitle: productWindow.title,
        interaction: "command-palette",
        shortcut: "Mod+K",
        commandId: "terminal.toggle",
        commandLocale: selectedCommand.locale,
        commandTitle: selectedCommand.title,
        terminal: "pty-active",
      }),
      runtimeRestart,
      processes,
      shutdown,
    });
    assertNoCredentialMaterial(JSON.stringify(result), "Packaged smoke report");
  } catch (error) {
    primaryFailure = error;
  } finally {
    stopCensus = true;
    await censusTask?.catch(() => undefined);
    if (application) {
      const output = application.output();
      if (output.overflow) {
        primaryFailure = new Error("Packaged application produced excessive product smoke output.");
      } else {
        try {
          assertNoCredentialMaterial(output.stdout, "Packaged application stdout");
          assertNoCredentialMaterial(output.stderr, "Packaged application stderr");
        } catch (error) {
          primaryFailure = error;
        }
      }
    }
    if (primaryFailure) {
      if (observed.tauri) {
        await cleanupExactProcesses([observed.tauri], () => readCensus());
        await withTimeout(
          application?.exit ?? Promise.resolve({ code: 0, signal: null }),
          5_000,
          "failed packaged Tauri cleanup",
        ).catch(() => undefined);
      }
      await cleanupExactProcesses(
        [...observed.tracked.values()].filter(
          (process) => !observed.tauri || identityKey(process) !== identityKey(observed.tauri),
        ),
        () => readCensus(),
      );
      await stopCapturedChild(application, 5_000);
    }
    await stopCapturedChild(decoy, 5_000);
    display = await stopOwnedDisplay(display, (child) => stopCapturedChild(child, 5_000));
    const remaining = processesReferencingRoots(await readCensus().catch(() => new Map()), [
      extractionRoot,
      stateRoot,
    ]);
    if (remaining.length === 0) {
      try {
        await removeIsolatedState(temporaryRoot, delay);
      } catch (error) {
        primaryFailure ??= error;
      }
    } else if (!primaryFailure) {
      primaryFailure = new Error("Packaged smoke cleanup retained a process in isolated state.");
    }
  }
  if (primaryFailure) throw primaryFailure;
  if (!result) throw new Error("Packaged product smoke did not produce a result.");
  return result;
}

function parseArguments(args: readonly string[]): LinuxPackagedProductSmokeOptions {
  if (args.length === 0) return {};
  if (args.length === 1 && args[0] === "--hard-death") {
    return { shutdownMode: "hard-death" };
  }
  if (args.length === 2 && args[0] === "--deb" && args[1]) return { debPath: args[1] };
  if (args.length === 3 && args[0] === "--hard-death" && args[1] === "--deb" && args[2]) {
    return { shutdownMode: "hard-death", debPath: args[2] };
  }
  throw new Error(
    "Usage: linux-packaged-product-smoke.ts [--hard-death] [--deb <final-package.deb>]",
  );
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const report = await runLinuxPackagedProductSmoke(parseArguments(args));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

const invokedFile = process.argv[1]
  ? await realpath(process.argv[1]).catch(() => undefined)
  : undefined;
if (invokedFile === (await realpath(fileURLToPath(import.meta.url)))) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Packaged product smoke failed.");
    process.exitCode = 1;
  }
}
