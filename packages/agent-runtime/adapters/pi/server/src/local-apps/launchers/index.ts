import { launchLinuxApp } from "./linux";
import { launchMacOSApp } from "./macos";
import { launchWindowsApp } from "./windows";
import type { DetectedLocalApp, LocalAppLaunchTarget } from "../types";

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
