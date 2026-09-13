import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { TERMINAL_SHELLS } from "@workbench/terminal-contracts";
import {
  configuredTerminalShell,
  createTerminalShellPreference,
  terminalShellExecutable,
} from "../src/terminal-shell";

test("PowerShell recognizes Store execution aliases whose targets cannot be stat-ed", (t) => {
  const store = String.raw`C:\Users\test\AppData\Local\Microsoft\WindowsApps\pwsh.exe`;
  const environment = { LOCALAPPDATA: String.raw`C:\Users\test\AppData\Local` };
  t.mock.method(fs, "existsSync", () => false);
  const lstat = t.mock.method(
    fs,
    "lstatSync",
    (path: string): { isSymbolicLink(): boolean } | undefined => {
      assert.equal(path, store);
      return { isSymbolicLink: () => true };
    },
  );
  assert.equal(terminalShellExecutable("powershell", environment), store);
  lstat.mock.mockImplementation(() => undefined);
  assert.equal(terminalShellExecutable("powershell", environment), "powershell.exe");
  lstat.mock.mockImplementation(() => {
    throw new Error("Access denied");
  });
  assert.equal(terminalShellExecutable("powershell", environment), "powershell.exe");
});

test("PowerShell discovers global tools, Scoop, and Preview without refreshed PATH", () => {
  const profile = String.raw`C:\Users\test`;
  const dotnet = String.raw`C:\Users\test\.dotnet\tools\pwsh.exe`;
  const scoop = String.raw`C:\Users\test\scoop\apps\pwsh\current\pwsh.exe`;
  const preview = String.raw`C:\Program Files\PowerShell\7-preview\pwsh.exe`;
  const stable = String.raw`C:\Program Files\PowerShell\7\pwsh.exe`;
  const cases: Array<{
    environment: Record<string, string>;
    available: string[];
    expected: string;
  }> = [
    { environment: { USERPROFILE: profile }, available: [dotnet], expected: dotnet },
    {
      environment: { DOTNET_CLI_HOME: String.raw`D:\dotnet` },
      available: [String.raw`D:\dotnet\.dotnet\tools\pwsh.exe`],
      expected: String.raw`D:\dotnet\.dotnet\tools\pwsh.exe`,
    },
    { environment: { USERPROFILE: profile }, available: [scoop], expected: scoop },
    {
      environment: { SCOOP: String.raw`D:\scoop` },
      available: [String.raw`D:\scoop\apps\pwsh\current\pwsh.exe`],
      expected: String.raw`D:\scoop\apps\pwsh\current\pwsh.exe`,
    },
    {
      environment: { SCOOP_GLOBAL: String.raw`E:\scoop` },
      available: [String.raw`E:\scoop\apps\pwsh\current\pwsh.exe`],
      expected: String.raw`E:\scoop\apps\pwsh\current\pwsh.exe`,
    },
    {
      environment: { ProgramData: String.raw`C:\ProgramData` },
      available: [String.raw`C:\ProgramData\scoop\apps\pwsh\current\pwsh.exe`],
      expected: String.raw`C:\ProgramData\scoop\apps\pwsh\current\pwsh.exe`,
    },
    {
      environment: { programfiles: String.raw`C:\Program Files` },
      available: [preview],
      expected: preview,
    },
    {
      environment: { ProgramFiles: String.raw`C:\Program Files` },
      available: [preview, stable],
      expected: stable,
    },
    {
      environment: {
        PATH: String.raw`C:\Program Files\PowerShell\7-preview`,
        ProgramFiles: String.raw`C:\Program Files`,
      },
      available: [preview, stable],
      expected: preview,
    },
    {
      environment: { localappdata: String.raw`C:\Users\test\AppData\Local` },
      available: [String.raw`C:\Users\test\AppData\Local\Microsoft\WindowsApps\pwsh-preview.exe`],
      expected: String.raw`C:\Users\test\AppData\Local\Microsoft\WindowsApps\pwsh-preview.exe`,
    },
    {
      environment: { SCOOP: "relative", USERPROFILE: "relative", ProgramFiles: "relative" },
      available: [],
      expected: "powershell.exe",
    },
  ];
  for (const { environment, available, expected } of cases) {
    assert.equal(
      terminalShellExecutable("powershell", environment, (path) => available.includes(path)),
      expected,
      JSON.stringify(environment),
    );
  }
});

test("PowerShell prefers pwsh from PATH, standard installs, or WindowsApps", () => {
  const native = String.raw`C:\Program Files\PowerShell\7\pwsh.exe`;
  const x86 = String.raw`C:\Program Files (x86)\PowerShell\7\pwsh.exe`;
  const portable = String.raw`D:\Portable PowerShell\pwsh.exe`;
  const second = String.raw`E:\Other PowerShell\pwsh.exe`;
  const store = String.raw`C:\Users\test\AppData\Local\Microsoft\WindowsApps\pwsh.exe`;
  const cases = [
    {
      environment: {
        PATH: String.raw`C:\Missing;"D:\Portable PowerShell";E:\Other PowerShell`,
        ProgramFiles: String.raw`C:\Program Files`,
      },
      available: [portable, second, native],
      expected: portable,
    },
    {
      environment: { Path: String.raw`D:\Portable PowerShell` },
      available: [portable],
      expected: portable,
    },
    {
      environment: { pAtH: String.raw`D:\Portable PowerShell` },
      available: [portable],
      expected: portable,
    },
    {
      environment: { ProgramFiles: String.raw`C:\Program Files` },
      available: [native],
      expected: native,
    },
    {
      environment: {
        ProgramW6432: String.raw`C:\Program Files`,
        ProgramFiles: String.raw`C:\Program Files (x86)`,
      },
      available: [native, x86],
      expected: native,
    },
    {
      environment: { "ProgramFiles(x86)": String.raw`C:\Program Files (x86)` },
      available: [x86],
      expected: x86,
    },
    {
      environment: { LOCALAPPDATA: String.raw`C:\Users\test\AppData\Local` },
      available: [store],
      expected: store,
    },
    {
      environment: { PATH: "; ;.;relative" },
      available: ["pwsh.exe", String.raw`relative\pwsh.exe`],
      expected: "powershell.exe",
    },
    {
      environment: { ProgramFiles: String.raw`C:\Program Files` },
      available: [],
      expected: "powershell.exe",
    },
  ];
  for (const { environment, available, expected } of cases) {
    assert.equal(
      terminalShellExecutable("powershell", environment, (candidate) =>
        available.includes(candidate),
      ),
      expected,
      JSON.stringify(environment),
    );
  }
});

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
  assert.equal(configuredTerminalShell(undefined, {}, "win32"), "powershell.exe");
  assert.equal(configuredTerminalShell(undefined, {}, "linux"), "/bin/bash");
  assert.equal(
    configuredTerminalShell(undefined, { WORKBENCH_TERMINAL_SHELL: "powershell.exe" }, "win32"),
    "powershell.exe",
  );
  assert.throws(() => preference.setShell("C:\\untrusted.exe" as never));
  assert.equal(preference.getShell(), "powershell.exe");
  assert.throws(() => createTerminalShellPreference({}, "linux").setShell("wsl"));
});
