import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { detectLinuxApps } from "./linux";
import { detectMacOSApps } from "./macos";
import { detectWindowsApps } from "./windows";

test("Windows prefers App Paths and still exposes the system file manager", async () => {
  const codePath = "C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe";
  const apps = await detectWindowsApps(undefined, {
    env: {},
    exists: async (candidate) => candidate === codePath,
    run: async (_command, args) => {
      const key = args[1] ?? "";
      if (key.endsWith("App Paths\\Code.exe")) {
        return { stdout: `(默认)    REG_SZ    ${codePath}\r\n`, stderr: "" };
      }
      throw new Error("not found");
    },
  });

  assert.deepEqual(
    apps.map(({ id, launcher }) => ({ id, launcher })),
    [
      { id: "vscode", launcher: { type: "executable", path: codePath } },
      { id: "file-manager", launcher: { type: "default" } },
    ],
  );
});

test("Windows keeps Trae and Trae CN uninstall entries distinct", async () => {
  const traeCnPath = "C:\\Users\\me\\AppData\\Local\\Programs\\Trae CN\\Trae CN.exe";
  const apps = await detectWindowsApps(undefined, {
    env: {},
    exists: async (candidate) => candidate === traeCnPath,
    run: async (_command, args) => {
      if (args.includes("/s")) {
        return {
          stdout: [
            "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Trae CN",
            "    DisplayName    REG_SZ    Trae CN",
            `    DisplayIcon    REG_SZ    ${traeCnPath}`,
          ].join("\r\n"),
          stderr: "",
        };
      }
      throw new Error("not found");
    },
  });

  assert.deepEqual(
    apps.map(({ id }) => id),
    ["trae-cn", "file-manager"],
  );
});

test("macOS detects applications by bundle identifier", async () => {
  const appPath = "/Applications/Cursor.app";
  const apps = await detectMacOSApps(undefined, {
    home: "/Users/me",
    exists: async (candidate) => candidate === appPath,
    run: async (_command, args) => {
      if (args[0]?.includes("com.todesktop.230313mzl4w4u92")) {
        return { stdout: `${appPath}\n`, stderr: "" };
      }
      throw new Error("not found");
    },
  });

  assert.deepEqual(
    apps.map(({ id, launcher }) => ({ id, launcher })),
    [
      {
        id: "cursor",
        launcher: { type: "mac-bundle", bundleId: "com.todesktop.230313mzl4w4u92" },
      },
      { id: "file-manager", launcher: { type: "default" } },
    ],
  );
});

test("Linux discovers registered applications from XDG desktop entries", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-local-app-xdg-"));
  const applications = path.join(root, "applications");
  const desktopFile = path.join(applications, "code.desktop");
  await mkdir(applications);
  await writeFile(
    desktopFile,
    "[Desktop Entry]\nName=Visual Studio Code\nExec=/usr/bin/code %F\nType=Application\n",
  );
  t.after(() => rm(root, { recursive: true, force: true }));

  const apps = await detectLinuxApps(undefined, {
    env: { PATH: "/usr/bin", XDG_DATA_HOME: root, XDG_DATA_DIRS: root },
    home: root,
    exists: async (candidate) => candidate === desktopFile || candidate === "/usr/bin/gio",
    run: async () => {
      throw new Error("not found");
    },
  });

  assert.deepEqual(
    apps.map(({ id, launcher }) => ({ id, launcher })),
    [
      {
        id: "vscode",
        launcher: {
          type: "desktop-entry",
          command: "/usr/bin/gio",
          desktopId: "code.desktop",
          path: desktopFile,
        },
      },
      { id: "file-manager", launcher: { type: "default" } },
    ],
  );
});

test("Linux discovers a registered editor from the localized XDG desktop directory", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-local-app-desktop-"));
  const config = path.join(root, ".config");
  const desktop = path.join(root, "桌面");
  const desktopFile = path.join(desktop, "Cursor.desktop");
  await mkdir(config);
  await mkdir(desktop);
  await writeFile(path.join(config, "user-dirs.dirs"), 'XDG_DESKTOP_DIR="$HOME/桌面"\n');
  await writeFile(
    desktopFile,
    "[Desktop Entry]\nName=Cursor\nExec=/opt/Cursor/AppRun %F\nType=Application\n",
  );
  t.after(() => rm(root, { recursive: true, force: true }));

  const apps = await detectLinuxApps(undefined, {
    env: {
      PATH: "/usr/bin",
      XDG_CONFIG_HOME: config,
      XDG_DATA_HOME: path.join(root, "share"),
      XDG_DATA_DIRS: path.join(root, "share"),
    },
    home: root,
    exists: async (candidate) => candidate === desktopFile || candidate === "/usr/bin/gio",
    run: async () => {
      throw new Error("not found");
    },
  });

  assert.deepEqual(
    apps.map(({ id, launcher }) => ({ id, launcher })),
    [
      {
        id: "cursor",
        launcher: {
          type: "desktop-entry",
          command: "/usr/bin/gio",
          desktopId: "Cursor.desktop",
          path: desktopFile,
        },
      },
      { id: "file-manager", launcher: { type: "default" } },
    ],
  );
});

test("Linux recognizes Trae and Trae CN from their desktop entries", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-local-app-trae-"));
  const applications = path.join(root, "applications");
  const trae = path.join(applications, "trae.desktop");
  const traeCn = path.join(applications, "trae-cn.desktop");
  await mkdir(applications);
  await writeFile(trae, "[Desktop Entry]\nName=Trae\nExec=/usr/bin/trae %F\nType=Application\n");
  await writeFile(
    traeCn,
    "[Desktop Entry]\nName=Trae CN\nExec=/usr/bin/trae-cn %F\nType=Application\n",
  );
  t.after(() => rm(root, { recursive: true, force: true }));

  const apps = await detectLinuxApps(undefined, {
    env: { PATH: "/usr/bin", XDG_DATA_HOME: root, XDG_DATA_DIRS: root },
    home: root,
    exists: async (candidate) =>
      candidate === trae || candidate === traeCn || candidate === "/usr/bin/gio",
    run: async () => {
      throw new Error("not found");
    },
  });

  assert.deepEqual(
    apps.map(({ id }) => id),
    ["trae", "trae-cn", "file-manager"],
  );
});
