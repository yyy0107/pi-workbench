import { homedir } from "node:os";
import path from "node:path";

import { APP_REGISTRY, FILE_MANAGER_APP } from "../registry";
import { localAppView } from "../types";
import {
  localAppPathExists,
  runLocalAppCommand,
  type LocalAppCommandRunner,
  type LocalAppPathExists,
} from "../process";
import type { DetectedLocalApp, LocalAppDefinition } from "../types";

export interface MacOSDetectorInternals {
  home?: string;
  exists?: LocalAppPathExists;
  run?: LocalAppCommandRunner;
}

async function findBundle(
  bundleId: string,
  run: LocalAppCommandRunner,
  exists: LocalAppPathExists,
  signal?: AbortSignal,
): Promise<string | undefined> {
  try {
    const query = `kMDItemCFBundleIdentifier == '${bundleId}'`;
    const { stdout } = await run("/usr/bin/mdfind", [query], signal);
    for (const candidate of stdout.split(/\r?\n/).map((value) => value.trim())) {
      if (candidate.endsWith(".app") && (await exists(candidate))) return candidate;
    }
  } catch {
    signal?.throwIfAborted();
  }
  return undefined;
}

function detectedBundle(definition: LocalAppDefinition, bundleId: string): DetectedLocalApp {
  return {
    ...localAppView(definition),
    platform: "macos",
    targetMode: definition.targetMode ?? "path",
    launcher: { type: "mac-bundle", bundleId },
  };
}

function detectedPath(definition: LocalAppDefinition, appPath: string): DetectedLocalApp {
  return {
    ...localAppView(definition),
    platform: "macos",
    targetMode: definition.targetMode ?? "path",
    launcher: { type: "mac-app", path: appPath },
  };
}

export async function detectMacOSApps(
  signal?: AbortSignal,
  internals: MacOSDetectorInternals = {},
): Promise<DetectedLocalApp[]> {
  const home = internals.home ?? homedir();
  const exists = internals.exists ?? localAppPathExists;
  const run = internals.run ?? runLocalAppCommand;
  const detected: DetectedLocalApp[] = [];

  for (const definition of APP_REGISTRY) {
    signal?.throwIfAborted();
    const macos = definition.macos;
    if (!macos) continue;
    let app: DetectedLocalApp | undefined;

    for (const bundleId of macos.bundleIds ?? []) {
      if (await findBundle(bundleId, run, exists, signal)) {
        app = detectedBundle(definition, bundleId);
        break;
      }
    }
    if (!app) {
      const candidates = [
        ...(macos.knownPaths ?? []),
        ...(macos.appNames ?? []).flatMap((name) => [
          path.join("/Applications", `${name}.app`),
          path.join(home, "Applications", `${name}.app`),
        ]),
      ];
      for (const candidate of candidates) {
        if (await exists(candidate)) {
          app = detectedPath(definition, candidate);
          break;
        }
      }
    }
    if (app) detected.push(app);
  }

  detected.push({
    ...FILE_MANAGER_APP,
    platform: "macos",
    targetMode: "directory",
    launcher: { type: "default" },
  });
  return detected;
}
