export const TERMINAL_SHELLS = ["powershell", "command-prompt", "git-bash", "wsl"] as const;
export type TerminalShell = (typeof TERMINAL_SHELLS)[number];

export function isTerminalShell(value: unknown): value is TerminalShell {
  return TERMINAL_SHELLS.some((shell) => shell === value);
}

export const SET_DEFAULT_TERMINAL_SHELL_METHOD = "terminal.setDefaultShell";
export interface SetDefaultTerminalShellPayload {
  shell: TerminalShell;
}
export interface SetDefaultTerminalShellResult {
  shell: TerminalShell;
}
