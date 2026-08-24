import { detectLinuxApps } from "./linux";
import { detectMacOSApps } from "./macos";
import { detectWindowsApps } from "./windows";
import type { DetectedLocalApp, LocalAppPlatform } from "../types";

export function localAppPlatform(platform: NodeJS.Platform): LocalAppPlatform | undefined {
  switch (platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    default:
      return undefined;
  }
}

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
