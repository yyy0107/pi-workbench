import { spawnLocalAppDetached, type LocalAppDetachedSpawner } from "../process";
import type { DetectedLocalApp, LocalAppLaunchTarget } from "../types";

export async function launchMacOSApp(
  app: DetectedLocalApp,
  target: LocalAppLaunchTarget,
  spawnDetached: LocalAppDetachedSpawner = spawnLocalAppDetached,
): Promise<void> {
  const requestedTarget = app.targetMode === "directory" ? target.directory : target.path;
  if (app.launcher.type === "default") {
    await spawnDetached("/usr/bin/open", [requestedTarget]);
    return;
  }
  if (app.launcher.type === "mac-bundle") {
    await spawnDetached("/usr/bin/open", ["-b", app.launcher.bundleId, requestedTarget]);
    return;
  }
  if (app.launcher.type === "mac-app") {
    await spawnDetached("/usr/bin/open", ["-a", app.launcher.path, requestedTarget]);
    return;
  }
  throw new Error(`Unsupported macOS launcher: ${app.launcher.type}`);
}
