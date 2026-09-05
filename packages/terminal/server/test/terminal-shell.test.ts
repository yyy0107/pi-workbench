import assert from "node:assert/strict";
import test from "node:test";
import { TERMINAL_SHELLS } from "@workbench/terminal-contracts";
import {
  configuredTerminalShell,
  createTerminalShellPreference,
  terminalShellExecutable,
} from "../src/terminal-shell";

test("startup and live settings share profile resolution and retain legacy fallbacks", () => {
  assert.deepEqual(
    TERMINAL_SHELLS.map((shell) => terminalShellExecutable(shell, {}, () => false)),
    ["powershell.exe", "cmd.exe", "bash.exe", "wsl.exe"],
  );
  const gitBash = String.raw`C:\Program Files\Git\bin\bash.exe`;
  assert.equal(
    terminalShellExecutable(
      "git-bash",
      { ProgramFiles: String.raw`C:\Program Files` },
      (candidate) => candidate === gitBash,
    ),
    gitBash,
  );
  const environment = {
    PI_WORKBENCH_TERMINAL_SHELL_PROFILE: "command-prompt",
    PI_WORKBENCH_TERMINAL_SHELL: "legacy.exe",
    SHELL: "/bin/sh",
  };
  const preference = createTerminalShellPreference(environment, "win32");
  assert.equal(preference.getShell(), "cmd.exe");
  assert.deepEqual(preference.setShell("powershell"), { shell: "powershell" });
  assert.equal(preference.getShell(), "powershell.exe");
  assert.equal(configuredTerminalShell(" explicit.exe ", environment, "win32"), "explicit.exe");
  assert.equal(configuredTerminalShell(undefined, environment, "linux"), "legacy.exe");
  assert.equal(configuredTerminalShell(undefined, { SHELL: "/bin/sh" }, "linux"), "/bin/sh");
  assert.throws(() => preference.setShell("C:\\untrusted.exe" as never));
  assert.equal(preference.getShell(), "powershell.exe");
  assert.throws(() => createTerminalShellPreference({}, "linux").setShell("wsl"));
});
