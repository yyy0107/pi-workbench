import { existsSync } from "node:fs";
import { win32 } from "node:path";

import { isTerminalShell, type TerminalShell } from "@workbench/terminal-contracts";

type Environment = Readonly<Record<string, string | undefined>>;

export function terminalShellExecutable(
  shell: TerminalShell,
  environment: Environment,
  exists: (path: string) => boolean = existsSync,
): string {
  if (shell === "command-prompt") return "cmd.exe";
  if (shell === "wsl") return "wsl.exe";
  if (shell === "powershell") return "powershell.exe";
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
    (platform === "win32" ? "powershell.exe" : "/bin/bash")
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
