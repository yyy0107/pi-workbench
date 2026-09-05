import fs from "node:fs";
import { win32 } from "node:path";

import { isTerminalShell, type TerminalShell } from "@workbench/terminal-contracts";

type Environment = Readonly<Record<string, string | undefined>>;

function executableExists(path: string): boolean {
  if (fs.existsSync(path)) return true;
  // Store execution aliases can be launched even when stat/exists returns EACCES.
  // Inspect the reparse point itself instead of following its protected target.
  try {
    return fs.lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() ?? false;
  } catch {
    return false;
  }
}

export function terminalShellExecutable(
  shell: TerminalShell,
  environment: Environment,
  exists: (path: string) => boolean = executableExists,
): string {
  if (shell === "command-prompt") return "cmd.exe";
  if (shell === "wsl") return "wsl.exe";
  if (shell === "powershell") {
    // Windows environment keys are case-insensitive, including in copied environments.
    const env = Object.fromEntries(
      Object.entries(environment).map(([key, value]) => [key.toLowerCase(), value]),
    );
    const absolutePaths = (paths: Array<string | undefined>): string[] =>
      paths.filter((path): path is string => Boolean(path && win32.isAbsolute(path)));
    const pathDirectories = absolutePaths(
      (env.path ?? "").split(";").map((entry) => entry.trim().replace(/^"|"$/g, "")),
    );
    const programRoots = absolutePaths([
      env.programw6432,
      env.programfiles,
      env["programfiles(x86)"],
    ]);
    const storeDirectories = absolutePaths([env.localappdata]).map((root) =>
      win32.join(root, "Microsoft", "WindowsApps"),
    );
    const scoopRoots = absolutePaths([
      env.scoop || (env.userprofile && win32.join(env.userprofile, "scoop")),
      env.scoop_global || (env.programdata && win32.join(env.programdata, "scoop")),
    ]);
    const candidates = [
      ...pathDirectories.map((root) => win32.join(root, "pwsh.exe")),
      ...programRoots.map((root) => win32.join(root, "PowerShell", "7", "pwsh.exe")),
      ...storeDirectories.map((root) => win32.join(root, "pwsh.exe")),
      ...absolutePaths([env.dotnet_cli_home || env.userprofile]).map((root) =>
        win32.join(root, ".dotnet", "tools", "pwsh.exe"),
      ),
      ...scoopRoots.map((root) => win32.join(root, "apps", "pwsh", "current", "pwsh.exe")),
      // Known Preview locations are fallbacks; an explicit PATH choice still wins.
      ...programRoots.map((root) => win32.join(root, "PowerShell", "7-preview", "pwsh.exe")),
      ...[...pathDirectories, ...storeDirectories].map((root) =>
        win32.join(root, "pwsh-preview.exe"),
      ),
    ];
    return [...new Set(candidates)].find(exists) ?? "powershell.exe";
  }
  return (
    [
      environment.ProgramFiles,
      environment["ProgramFiles(x86)"],
      environment.LOCALAPPDATA && win32.join(environment.LOCALAPPDATA, "Programs"),
    ]
      .filter((root): root is string => Boolean(root))
      .map((root) => win32.join(root, "Git", "bin", "bash.exe"))
      .find(exists) ?? "bash.exe"
  );
}

export function configuredTerminalShell(
  shell: string | undefined,
  environment: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (shell?.trim()) return shell.trim();
  const profile = environment.PI_WORKBENCH_TERMINAL_SHELL_PROFILE;
  if (platform === "win32" && isTerminalShell(profile)) {
    return terminalShellExecutable(profile, environment);
  }
  return (
    environment.PI_WORKBENCH_TERMINAL_SHELL?.trim() ||
    environment.WORKBENCH_TERMINAL_SHELL?.trim() ||
    environment.SHELL?.trim() ||
    (platform === "win32" ? terminalShellExecutable("powershell", environment) : "/bin/bash")
  );
}

/** One Runtime-owned default; consumers snapshot it when allocating a session. */
export function createTerminalShellPreference(
  environment: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
) {
  let executable = configuredTerminalShell(undefined, environment, platform);
  return {
    getShell: () => executable,
    setShell(shell: TerminalShell) {
      if (platform !== "win32" || !isTerminalShell(shell)) {
        throw new Error("Unsupported terminal shell profile.");
      }
      executable = terminalShellExecutable(shell, environment);
      return { shell };
    },
  };
}
