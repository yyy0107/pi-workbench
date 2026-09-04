import path from "node:path";

import { spawnLocalAppDetached, type LocalAppDetachedSpawner } from "../process";
import type { DetectedLocalApp, LocalAppLaunchTarget } from "../types";

export async function launchWindowsApp(
  app: DetectedLocalApp,
  target: LocalAppLaunchTarget,
  spawnDetached: LocalAppDetachedSpawner = spawnLocalAppDetached,
): Promise<void> {
  if (app.launcher.type === "default") {
    await spawnDetached("explorer.exe", [target.directory]);
    return;
  }
  if (app.launcher.type !== "executable") {
    throw new Error(`Unsupported Windows launcher: ${app.launcher.type}`);
  }

  if (app.kind !== "terminal") {
    await spawnDetached(app.launcher.path, [target.path]);
    return;
  }

  const executable = path.win32.basename(app.launcher.path).toLowerCase();
  if (executable === "wt.exe" || executable === "wt") {
    await spawnDetached(app.launcher.path, ["-d", target.directory]);
    return;
  }
  await spawnDetached(app.launcher.path, [], { cwd: target.directory });
}
