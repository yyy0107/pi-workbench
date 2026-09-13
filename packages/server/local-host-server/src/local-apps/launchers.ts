import { launchLinuxApp } from "./launcher-linux";
import { launchMacOSApp } from "./launcher-macos";
import { launchWindowsApp } from "./launcher-windows";
import type { DetectedLocalApp, LocalAppLaunchTarget } from "./types";

export function launchLocalApp(app: DetectedLocalApp, target: LocalAppLaunchTarget): Promise<void> {
  switch (app.platform) {
    case "windows":
      return launchWindowsApp(app, target);
    case "macos":
      return launchMacOSApp(app, target);
    case "linux":
      return launchLinuxApp(app, target);
  }
}
