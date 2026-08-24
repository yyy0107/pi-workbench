import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { APP_REGISTRY, FILE_MANAGER_APP } from "../registry";
import {
  findExecutable,
  localAppPathExists,
  runLocalAppCommand,
  type LocalAppCommandRunner,
  type LocalAppPathExists,
} from "../process";
import type { DetectedLocalApp, LinuxLocalAppDefinition, LocalAppDefinition } from "../types";

export interface LinuxDetectorInternals {
  env?: Readonly<Record<string, string | undefined>>;
  home?: string;
  exists?: LocalAppPathExists;
  run?: LocalAppCommandRunner;
}

function desktopDirectories(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string[] {
  const dataHome = env.XDG_DATA_HOME || path.join(home, ".local", "share");
  const dataDirs = (env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":").filter(Boolean);
  return [
    path.join(dataHome, "applications"),
    ...dataDirs.map((directory) => path.join(directory, "applications")),
    path.join(dataHome, "flatpak", "exports", "share", "applications"),
    "/var/lib/flatpak/exports/share/applications",
    "/var/lib/snapd/desktop/applications",
  ].filter((directory, index, all) => all.indexOf(directory) === index);
}

function expandXdgUserDirectory(value: string, home: string): string | undefined {
  const expanded = value.replace(/^\$\{HOME\}(?=\/|$)/, home).replace(/^\$HOME(?=\/|$)/, home);
  return path.isAbsolute(expanded) ? path.normalize(expanded) : undefined;
}

async function xdgDesktopDirectory(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): Promise<string> {
  const configHome = env.XDG_CONFIG_HOME || path.join(home, ".config");
  try {
    const source = await readFile(path.join(configHome, "user-dirs.dirs"), "utf8");
    const match = source.match(
      /^\s*XDG_DESKTOP_DIR\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))\s*(?:#.*)?$/m,
    );
    const configured = match?.[1] ?? match?.[2] ?? match?.[3];
    const expanded = configured ? expandXdgUserDirectory(configured, home) : undefined;
    if (expanded) return expanded;
  } catch {
    // XDG user directories are optional; fall back to the conventional location.
  }
  return path.join(home, "Desktop");
}

async function desktopEntryUsable(candidate: string): Promise<boolean> {
  try {
    const source = await readFile(candidate, "utf8");
    if (!/^\s*\[Desktop Entry\]\s*$/m.test(source)) return false;
    if (/^\s*Type\s*=\s*(?!Application\s*$)/im.test(source)) return false;
    if (/^\s*Hidden\s*=\s*true\s*$/im.test(source)) return false;
    return /^\s*Exec\s*=\s*\S+/im.test(source);
  } catch {
    return false;
  }
}

async function findDesktopEntry(
  definition: LinuxLocalAppDefinition,
  directories: readonly string[],
  exists: LocalAppPathExists,
): Promise<{ desktopId: string; path: string } | undefined> {
  for (const desktopId of definition.desktopIds ?? []) {
    for (const directory of directories) {
      const candidate = path.join(directory, desktopId);
      if ((await exists(candidate)) && (await desktopEntryUsable(candidate))) {
        return { desktopId, path: candidate };
      }
    }
  }

  for (const directory of directories) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".desktop")) continue;
      if (!(definition.desktopIdPrefixes ?? []).some((prefix) => entry.name.startsWith(prefix))) {
        continue;
      }
      const candidate = path.join(directory, entry.name);
      if (await desktopEntryUsable(candidate)) {
        return { desktopId: entry.name, path: candidate };
      }
    }
  }
  return undefined;
}

function detectedExecutable(definition: LocalAppDefinition, executable: string): DetectedLocalApp {
  return {
    id: definition.id,
    name: definition.name,
    kind: definition.kind,
    ...(definition.icon ? { icon: definition.icon } : {}),
    platform: "linux",
    targetMode: definition.targetMode ?? "path",
    launcher: { type: "executable", path: executable },
  };
}

async function flatpakApplications(
  flatpak: string | undefined,
  run: LocalAppCommandRunner,
  signal?: AbortSignal,
): Promise<Set<string>> {
  if (!flatpak) return new Set();
  try {
    const { stdout } = await run(flatpak, ["list", "--app", "--columns=application"], signal);
    return new Set(
      stdout
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
    );
  } catch {
    signal?.throwIfAborted();
    return new Set();
  }
}

export async function detectLinuxApps(
  signal?: AbortSignal,
  internals: LinuxDetectorInternals = {},
): Promise<DetectedLocalApp[]> {
  const env = internals.env ?? process.env;
  const home = internals.home ?? homedir();
  const exists = internals.exists ?? localAppPathExists;
  const run = internals.run ?? runLocalAppCommand;
  const desktopLauncher = await findExecutable(["gio", "gtk-launch"], {
    env,
    platform: "linux",
    exists,
  });
  const directories = desktopDirectories(env, home);
  if (desktopLauncher && path.basename(desktopLauncher) === "gio") {
    directories.push(await xdgDesktopDirectory(env, home));
  }
  const flatpak = await findExecutable(["flatpak"], { env, platform: "linux", exists });
  const flatpakApps = await flatpakApplications(flatpak, run, signal);
  const detected: DetectedLocalApp[] = [];

  for (const definition of APP_REGISTRY) {
    signal?.throwIfAborted();
    const linux = definition.linux;
    if (!linux) continue;
    const desktop = await findDesktopEntry(linux, directories, exists);
    if (desktop && desktopLauncher) {
      detected.push({
        id: definition.id,
        name: definition.name,
        kind: definition.kind,
        ...(definition.icon ? { icon: definition.icon } : {}),
        platform: "linux",
        targetMode: definition.targetMode ?? "path",
        launcher: {
          type: "desktop-entry",
          command: desktopLauncher,
          desktopId: desktop.desktopId,
          path: desktop.path,
        },
      });
      continue;
    }

    const executable = await findExecutable(linux.executables ?? [], {
      env,
      platform: "linux",
      exists,
    });
    if (executable) {
      detected.push(detectedExecutable(definition, executable));
      continue;
    }

    const flatpakId = (linux.flatpakIds ?? []).find((id) => flatpakApps.has(id));
    if (flatpakId && flatpak) {
      detected.push({
        id: definition.id,
        name: definition.name,
        kind: definition.kind,
        ...(definition.icon ? { icon: definition.icon } : {}),
        platform: "linux",
        targetMode: definition.targetMode ?? "path",
        launcher: { type: "flatpak", command: flatpak, applicationId: flatpakId },
      });
    }
  }

  detected.push({
    ...FILE_MANAGER_APP,
    platform: "linux",
    targetMode: "directory",
    launcher: { type: "default" },
  });
  return detected;
}
