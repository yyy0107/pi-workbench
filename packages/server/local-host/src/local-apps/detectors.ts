import { detectLinuxApps } from "./detector-linux";
import { detectMacOSApps } from "./detector-macos";
import { detectWindowsApps } from "./detector-windows";
import type { DetectedLocalApp } from "./types";

export function detectInstalledApps(
  signal?: AbortSignal,
  platform: NodeJS.Platform = process.platform,
): Promise<DetectedLocalApp[]> {
  switch (platform) {
    case "win32":
      return detectWindowsApps(signal);
    case "darwin":
      return detectMacOSApps(signal);
    case "linux":
      return detectLinuxApps(signal);
    default:
      return Promise.resolve([]);
  }
}
