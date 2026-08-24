import assert from "node:assert/strict";
import test from "node:test";

import { launchLinuxApp } from "./linux";
import { launchMacOSApp } from "./macos";
import { launchWindowsApp } from "./windows";
import type { DetectedLocalApp, LocalAppLaunchTarget } from "../types";
import type { DetachedSpawnOptions } from "../process";

const target: LocalAppLaunchTarget = {
  path: '/project/literal;$(touch injected)".ts',
  directory: "/project",
};

function spawnRecorder() {
  const calls: Array<{ command: string; args: readonly string[]; options?: DetachedSpawnOptions }> =
    [];
  return {
    calls,
    spawn: async (command: string, args: readonly string[], options?: DetachedSpawnOptions) => {
      calls.push({ command, args, options });
    },
  };
}

test("Windows launchers pass paths as literal argv values", async () => {
  const editor: DetectedLocalApp = {
    id: "vscode",
    name: "VS Code",
    kind: "editor",
    platform: "windows",
    targetMode: "path",
    launcher: { type: "executable", path: "C:\\Program Files\\VS Code\\Code.exe" },
  };
  const recorder = spawnRecorder();
  await launchWindowsApp(editor, target, recorder.spawn);
  assert.deepEqual(recorder.calls, [
    {
      command: "C:\\Program Files\\VS Code\\Code.exe",
      args: [target.path],
      options: undefined,
    },
  ]);
});

test("macOS launchers use bundle identifiers without resolving app paths in the renderer", async () => {
  const editor: DetectedLocalApp = {
    id: "cursor",
    name: "Cursor",
    kind: "editor",
    platform: "macos",
    targetMode: "path",
    launcher: { type: "mac-bundle", bundleId: "com.todesktop.230313mzl4w4u92" },
  };
  const recorder = spawnRecorder();
  await launchMacOSApp(editor, target, recorder.spawn);
  assert.deepEqual(recorder.calls[0], {
    command: "/usr/bin/open",
    args: ["-b", "com.todesktop.230313mzl4w4u92", target.path],
    options: undefined,
  });
});

test("Linux desktop entries launch through gio with argv isolation", async () => {
  const editor: DetectedLocalApp = {
    id: "vscode",
    name: "VS Code",
    kind: "editor",
    platform: "linux",
    targetMode: "path",
    launcher: {
      type: "desktop-entry",
      command: "/usr/bin/gio",
      desktopId: "code.desktop",
      path: "/usr/share/applications/code.desktop",
    },
  };
  const recorder = spawnRecorder();
  await launchLinuxApp(editor, target, recorder.spawn);
  assert.deepEqual(recorder.calls[0], {
    command: "/usr/bin/gio",
    args: ["launch", "/usr/share/applications/code.desktop", target.path],
    options: undefined,
  });
});

test("system terminal and file-manager launchers receive directories", async () => {
  const terminal: DetectedLocalApp = {
    id: "terminal",
    name: "Terminal",
    kind: "terminal",
    platform: "linux",
    targetMode: "directory",
    launcher: { type: "executable", path: "/usr/bin/kitty" },
  };
  const manager: DetectedLocalApp = {
    id: "file-manager",
    name: "File Manager",
    kind: "file-manager",
    platform: "linux",
    targetMode: "directory",
    launcher: { type: "default" },
  };
  const recorder = spawnRecorder();
  await launchLinuxApp(terminal, target, recorder.spawn);
  await launchLinuxApp(manager, target, recorder.spawn);
  assert.deepEqual(recorder.calls, [
    {
      command: "/usr/bin/kitty",
      args: ["--directory", target.directory],
      options: { cwd: target.directory },
    },
    { command: "xdg-open", args: [target.directory], options: undefined },
  ]);
});
