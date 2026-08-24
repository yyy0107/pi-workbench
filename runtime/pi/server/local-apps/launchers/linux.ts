import path from "node:path";

import { spawnLocalAppDetached, type LocalAppDetachedSpawner } from "../process";
import type { DetectedLocalApp, LocalAppLaunchTarget } from "../types";

function terminalArguments(executablePath: string, directory: string): string[] {
  switch (path.basename(executablePath)) {
    case "ghostty":
      return [`--working-directory=${directory}`];
    case "wezterm":
      return ["start", "--cwd", directory];
    case "kitty":
      return ["--directory", directory];
    case "alacritty":
      return ["--working-directory", directory];
    case "gnome-terminal":
      return [`--working-directory=${directory}`];
    case "konsole":
      return ["--workdir", directory];
    default:
      return [];
  }
}

export async function launchLinuxApp(
  app: DetectedLocalApp,
  target: LocalAppLaunchTarget,
  spawnDetached: LocalAppDetachedSpawner = spawnLocalAppDetached,
): Promise<void> {
  const requestedTarget = app.targetMode === "directory" ? target.directory : target.path;
  if (app.launcher.type === "default") {
    await spawnDetached("xdg-open", [requestedTarget]);
    return;
  }
  if (app.launcher.type === "executable") {
    if (app.kind === "terminal") {
      await spawnDetached(
        app.launcher.path,
        terminalArguments(app.launcher.path, target.directory),
        { cwd: target.directory },
      );
      return;
    }
    await spawnDetached(app.launcher.path, [requestedTarget]);
    return;
  }
  if (app.launcher.type === "desktop-entry") {
    if (path.basename(app.launcher.command) === "gio") {
      await spawnDetached(app.launcher.command, ["launch", app.launcher.path, requestedTarget]);
      return;
    }
    await spawnDetached(app.launcher.command, [
      app.launcher.desktopId.replace(/\.desktop$/, ""),
      requestedTarget,
    ]);
    return;
  }
  if (app.launcher.type === "flatpak") {
    await spawnDetached(app.launcher.command, ["run", app.launcher.applicationId, requestedTarget]);
    return;
  }
  throw new Error(`Unsupported Linux launcher: ${app.launcher.type}`);
}
