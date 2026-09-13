import { execFile } from "node:child_process";
import { open } from "node:fs/promises";
import { join } from "node:path";

import type { PackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";

import type { PiPackageUpdateView } from "@workbench/agent-runtime-pi-protocol/rpc";

const PACKAGE_JSON_LIMIT_BYTES = 1024 * 1024;
const COMMAND_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const COMMAND_TIMEOUT_MS = 10_000;

type PackageUpdateMetadata = Pick<
  PiPackageUpdateView,
  "currentRevision" | "currentVersion" | "targetRevision" | "targetVersion"
>;

export type InstalledPackageUpdateState =
  | { type: "npm"; version: string }
  | { type: "git"; revision: string };

interface PackageUpdateCommandOptions {
  cwd: string;
  env?: Readonly<Record<string, string>>;
}

export type PackageUpdateCommandRunner = (
  command: string,
  args: readonly string[],
  options: PackageUpdateCommandOptions,
) => Promise<string>;

function metadataValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 256) : undefined;
}

async function readInstalledVersion(installedPath: string): Promise<string | undefined> {
  const packageJsonFile = await open(join(installedPath, "package.json"), "r");
  try {
    const stats = await packageJsonFile.stat();
    if (!stats.isFile() || stats.size > PACKAGE_JSON_LIMIT_BYTES) return undefined;
    const packageJson = await packageJsonFile.readFile("utf8");
    if (Buffer.byteLength(packageJson, "utf8") > PACKAGE_JSON_LIMIT_BYTES) return undefined;
    const parsed = JSON.parse(packageJson.replace(/^\uFEFF/, "")) as unknown;
    if (typeof parsed !== "object" || parsed === null || !("version" in parsed)) return undefined;
    return metadataValue(parsed.version);
  } finally {
    await packageJsonFile.close();
  }
}

/** Reads only the local identity needed to prove that an update changed the installed package. */
export async function resolveInstalledPackageUpdateState(
  type: PiPackageUpdateView["type"],
  installedPath: string,
  runCommand: PackageUpdateCommandRunner = runPackageUpdateCommand,
): Promise<InstalledPackageUpdateState | undefined> {
  if (type === "npm") {
    const version = await readInstalledVersion(installedPath).catch(() => undefined);
    return version ? { type, version } : undefined;
  }

  const revision = await runCommand("git", ["rev-parse", "HEAD"], { cwd: installedPath })
    .then(metadataValue)
    .catch(() => undefined);
  return revision ? { type, revision } : undefined;
}

export function parseNpmVersionOutput(output: string): string | undefined {
  const parsed = JSON.parse(output) as unknown;
  if (typeof parsed === "string") return metadataValue(parsed);
  if (!Array.isArray(parsed)) return undefined;
  const versions = parsed.flatMap((value) => {
    const version = metadataValue(value);
    return version ? [version] : [];
  });
  return versions.at(-1);
}

function runPackageUpdateCommand(
  command: string,
  args: readonly string[],
  options: PackageUpdateCommandOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        cwd: options.cwd,
        encoding: "utf8",
        env: { ...process.env, ...options.env },
        maxBuffer: COMMAND_OUTPUT_LIMIT_BYTES,
        timeout: COMMAND_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

async function resolveNpmMetadata(
  source: string,
  installedPath: string,
  cwd: string,
  settingsManager: Pick<SettingsManager, "getNpmCommand">,
  runCommand: PackageUpdateCommandRunner,
): Promise<PackageUpdateMetadata> {
  const installedState = await resolveInstalledPackageUpdateState("npm", installedPath, runCommand);
  const currentVersion = installedState?.type === "npm" ? installedState.version : undefined;
  const spec = source.startsWith("npm:") ? source.slice("npm:".length).trim() : "";
  const configuredCommand = settingsManager.getNpmCommand();
  const commandParts = configuredCommand?.length ? configuredCommand : ["npm"];
  const [command, ...commandArgs] = commandParts;
  const targetVersion =
    command && spec
      ? await runCommand(command, [...commandArgs, "view", spec, "version", "--json"], {
          cwd,
        })
          .then(parseNpmVersionOutput)
          .catch(() => undefined)
      : undefined;

  return {
    ...(currentVersion ? { currentVersion } : {}),
    ...(targetVersion ? { targetVersion } : {}),
  };
}

function parseGitRevision(output: string, ref?: string): string | undefined {
  const pattern = ref
    ? new RegExp(`^([0-9a-f]{40})\\s+${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m")
    : /^([0-9a-f]{40})\s+HEAD$/m;
  return pattern.exec(output)?.[1];
}

async function resolveGitMetadata(
  installedPath: string,
  runCommand: PackageUpdateCommandRunner,
): Promise<PackageUpdateMetadata> {
  const commandOptions = { cwd: installedPath };
  const remoteOptions = {
    cwd: installedPath,
    env: { GIT_TERMINAL_PROMPT: "0" },
  };
  const installedState = await resolveInstalledPackageUpdateState("git", installedPath, runCommand);
  const currentRevision = installedState?.type === "git" ? installedState.revision : undefined;
  const upstream = await runCommand(
    "git",
    ["rev-parse", "--abbrev-ref", "@{upstream}"],
    commandOptions,
  ).catch(() => "");
  const branch = upstream.trim().startsWith("origin/")
    ? upstream.trim().slice("origin/".length)
    : "";
  const ref = branch ? `refs/heads/${branch}` : undefined;
  const targetRevision = await runCommand(
    "git",
    ["ls-remote", "origin", ref ?? "HEAD"],
    remoteOptions,
  )
    .then((output) => parseGitRevision(output, ref))
    .catch(() => undefined);

  return {
    ...(currentRevision ? { currentRevision } : {}),
    ...(targetRevision ? { targetRevision } : {}),
  };
}

/**
 * Enriches the SDK's boolean update result without exposing package paths or command output.
 * Metadata failures are deliberately non-fatal: the authoritative update result still renders.
 */
export async function resolvePackageUpdateMetadata(
  update: Pick<PiPackageUpdateView, "scope" | "source" | "type">,
  packageManager: Pick<PackageManager, "getInstalledPath">,
  settingsManager: Pick<SettingsManager, "getNpmCommand">,
  cwd: string,
  runCommand: PackageUpdateCommandRunner = runPackageUpdateCommand,
): Promise<PackageUpdateMetadata> {
  try {
    const installedPath = packageManager.getInstalledPath(update.source, update.scope);
    if (!installedPath) return {};
    return update.type === "npm"
      ? await resolveNpmMetadata(update.source, installedPath, cwd, settingsManager, runCommand)
      : await resolveGitMetadata(installedPath, runCommand);
  } catch {
    return {};
  }
}
