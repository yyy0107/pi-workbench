import { readdir } from "node:fs/promises";
import path from "node:path";

import { APP_REGISTRY, FILE_MANAGER_APP } from "../registry";
import {
  findExecutable,
  localAppPathExists,
  runLocalAppCommand,
  type LocalAppCommandRunner,
  type LocalAppPathExists,
} from "../process";
import type { DetectedLocalApp, LocalAppDefinition, WindowsLocalAppDefinition } from "../types";

interface WindowsUninstallEntry {
  displayName?: string;
  displayIcon?: string;
  installLocation?: string;
}

export interface WindowsDetectorInternals {
  env?: Readonly<Record<string, string | undefined>>;
  exists?: LocalAppPathExists;
  run?: LocalAppCommandRunner;
}

const UNINSTALL_ROOTS = [
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
] as const;

function registryValue(stdout: string): string | undefined {
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:\([^)]*\)|<[^>]+>)\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/i);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

async function queryAppPath(
  executable: string,
  run: LocalAppCommandRunner,
  signal?: AbortSignal,
): Promise<string | undefined> {
  for (const hive of ["HKCU", "HKLM"] as const) {
    const key = `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executable}`;
    try {
      const { stdout } = await run("reg.exe", ["query", key, "/ve"], signal);
      const value = registryValue(stdout);
      if (value) return value;
    } catch {
      signal?.throwIfAborted();
    }
  }
  return undefined;
}

function parseUninstallEntries(stdout: string): WindowsUninstallEntry[] {
  const entries: WindowsUninstallEntry[] = [];
  let current: WindowsUninstallEntry | undefined;

  for (const line of stdout.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line.trim())) {
      if (current) entries.push(current);
      current = {};
      continue;
    }
    if (!current) continue;
    const match = line.match(
      /^\s*(DisplayName|DisplayIcon|InstallLocation)\s+REG_\w+\s+(.*?)\s*$/i,
    );
    if (!match?.[1] || !match[2]) continue;
    const key = match[1].toLowerCase();
    if (key === "displayname") current.displayName = match[2].trim();
    if (key === "displayicon") current.displayIcon = match[2].trim();
    if (key === "installlocation") current.installLocation = match[2].trim();
  }
  if (current) entries.push(current);
  return entries;
}

async function queryUninstallEntries(
  run: LocalAppCommandRunner,
  signal?: AbortSignal,
): Promise<WindowsUninstallEntry[]> {
  const results = await Promise.all(
    UNINSTALL_ROOTS.map(async (root) => {
      try {
        return parseUninstallEntries((await run("reg.exe", ["query", root, "/s"], signal)).stdout);
      } catch {
        signal?.throwIfAborted();
        return [];
      }
    }),
  );
  return results.flat();
}

function stripDisplayIconSuffix(value: string): string {
  const trimmed = value.trim();
  const quoted = trimmed.match(/^"([^"]+)"(?:,\s*-?\d+)?$/);
  if (quoted?.[1]) return quoted[1];
  return trimmed.replace(/,\s*-?\d+$/, "").trim();
}

function expandWindowsEnvironment(
  value: string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  return value.replace(/%([^%]+)%/g, (token, name: string) => {
    const match = Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase());
    return match?.[1] ?? token;
  });
}

async function findFileBelow(
  root: string,
  names: ReadonlySet<string>,
  exists: LocalAppPathExists,
  maxDepth = 5,
): Promise<string | undefined> {
  if (!(await exists(root))) return undefined;
  const queue: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];
  let visited = 0;

  while (queue.length && visited < 4_000) {
    const next = queue.shift();
    if (!next) break;
    let entries;
    try {
      entries = await readdir(next.directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      visited += 1;
      const candidate = path.win32.join(next.directory, entry.name);
      if (entry.isFile() && names.has(entry.name.toLowerCase())) return candidate;
      if (entry.isDirectory() && next.depth < maxDepth) {
        queue.push({ directory: candidate, depth: next.depth + 1 });
      }
    }
  }
  return undefined;
}

async function uninstallExecutable(
  definition: WindowsLocalAppDefinition,
  entries: readonly WindowsUninstallEntry[],
  exists: LocalAppPathExists,
): Promise<string | undefined> {
  const executableNames = new Set((definition.executables ?? []).map((name) => name.toLowerCase()));
  for (const entry of entries) {
    const displayName = entry.displayName?.toLowerCase();
    if (
      !displayName ||
      !(definition.uninstallNames ?? []).some((name) => displayName.includes(name.toLowerCase())) ||
      (definition.uninstallNameExcludes ?? []).some((name) =>
        displayName.includes(name.toLowerCase()),
      )
    ) {
      continue;
    }
    if (entry.displayIcon) {
      const candidate = stripDisplayIconSuffix(entry.displayIcon);
      if (await exists(candidate)) return candidate;
    }
    if (entry.installLocation) {
      const candidate = await findFileBelow(entry.installLocation, executableNames, exists, 3);
      if (candidate) return candidate;
    }
  }
  return undefined;
}

async function toolboxExecutable(
  definition: WindowsLocalAppDefinition,
  env: Readonly<Record<string, string | undefined>>,
  exists: LocalAppPathExists,
): Promise<string | undefined> {
  if (!definition.toolbox) return undefined;
  const names = new Set((definition.executables ?? []).map((name) => name.toLowerCase()));
  const roots = [
    env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, "JetBrains", "Toolbox", "apps") : "",
    env.ProgramFiles ? path.win32.join(env.ProgramFiles, "JetBrains") : "",
    env["ProgramFiles(x86)"] ? path.win32.join(env["ProgramFiles(x86)"]!, "JetBrains") : "",
  ].filter(Boolean);
  for (const root of roots) {
    const candidate = await findFileBelow(root, names, exists);
    if (candidate) return candidate;
  }
  return undefined;
}

function detectedApp(definition: LocalAppDefinition, executable: string): DetectedLocalApp {
  return {
    id: definition.id,
    name: definition.name,
    kind: definition.kind,
    ...(definition.icon ? { icon: definition.icon } : {}),
    supportedFileKinds: [...definition.supportedFileKinds],
    platform: "windows",
    targetMode: definition.targetMode ?? "path",
    launcher: { type: "executable", path: executable },
  };
}

export async function detectWindowsApps(
  signal?: AbortSignal,
  internals: WindowsDetectorInternals = {},
): Promise<DetectedLocalApp[]> {
  const env = internals.env ?? process.env;
  const exists = internals.exists ?? localAppPathExists;
  const run = internals.run ?? runLocalAppCommand;
  const uninstallEntries = await queryUninstallEntries(run, signal);
  const detected: DetectedLocalApp[] = [];

  for (const definition of APP_REGISTRY) {
    signal?.throwIfAborted();
    const windows = definition.windows;
    if (!windows) continue;
    let executable: string | undefined;

    for (const appPath of windows.appPaths ?? windows.executables ?? []) {
      const candidate = await queryAppPath(appPath, run, signal);
      if (candidate && (await exists(candidate))) {
        executable = candidate;
        break;
      }
    }
    executable ??= await uninstallExecutable(windows, uninstallEntries, exists);
    if (!executable) {
      for (const knownPath of windows.knownPaths ?? []) {
        const candidate = expandWindowsEnvironment(knownPath, env);
        if (await exists(candidate)) {
          executable = candidate;
          break;
        }
      }
    }
    executable ??= await findExecutable(windows.executables ?? [], {
      env,
      platform: "win32",
      exists,
    });
    executable ??= await toolboxExecutable(windows, env, exists);
    if (executable) detected.push(detectedApp(definition, executable));
  }

  detected.push({
    ...FILE_MANAGER_APP,
    platform: "windows",
    targetMode: "directory",
    launcher: { type: "default" },
  });
  return detected;
}
