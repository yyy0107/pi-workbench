import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { detectLinuxApps } from "../../../src/local-apps/detectors/linux";
import { detectMacOSApps } from "../../../src/local-apps/detectors/macos";
import { detectWindowsApps } from "../../../src/local-apps/detectors/windows";
import { LocalAppService } from "../../../src/local-apps/service";

test("carries PDF, image and Office format support from platform detection to the public application list", async () => {
  const officePaths = new Map([
    ["WINWORD.EXE", "C:\\Office\\WINWORD.EXE"],
    ["EXCEL.EXE", "C:\\Office\\EXCEL.EXE"],
    ["POWERPNT.EXE", "C:\\Office\\POWERPNT.EXE"],
  ]);
  const [windows, macos, linux] = await Promise.all([
    detectWindowsApps(undefined, {
      env: {},
      exists: async (candidate) => [...officePaths.values()].includes(candidate),
      run: async (_command, args) => {
        const name = args[1]?.split("\\").at(-1);
        const executable = name ? officePaths.get(name) : undefined;
        if (executable) return { stdout: `(Default)    REG_SZ    ${executable}\r\n`, stderr: "" };
        throw new Error("not found");
      },
    }),
    detectMacOSApps(undefined, {
      home: "/Users/me",
      exists: async (candidate) =>
        ["/System/Applications/Preview.app", "/Applications/Inkscape.app"].includes(candidate),
      run: async () => {
        throw new Error("not found");
      },
    }),
    detectLinuxApps(undefined, {
      env: { PATH: "/usr/bin", XDG_DATA_HOME: "/missing", XDG_DATA_DIRS: "/missing" },
      home: "/missing",
      exists: async (candidate) =>
        ["/usr/bin/okular", "/usr/bin/gimp", "/usr/bin/libreoffice"].includes(candidate),
      run: async () => {
        throw new Error("not found");
      },
    }),
  ]);
  const service = new LocalAppService({ detect: async () => [...windows, ...macos, ...linux] });
  const { apps } = await service.list();
  for (const [id, extension] of [
    ["word", "docx"],
    ["excel", "xlsx"],
    ["powerpoint", "pptx"],
    ["inkscape", "svg"],
    ["libreoffice", "ods"],
  ]) {
    const app = apps.find((candidate) => candidate.id === id);
    assert.ok(app?.supportedFileExtensions?.includes(extension!));
    assert.equal("launcher" in app!, false);
  }
  assert.deepEqual(apps.find((app) => app.id === "preview")?.supportedFileKinds, ["pdf", "image"]);
  assert.deepEqual(apps.find((app) => app.id === "okular")?.supportedFileKinds, ["pdf"]);
  assert.deepEqual(apps.find((app) => app.id === "gimp")?.supportedFileKinds, ["image"]);
  assert.ok(!apps.find((app) => app.id === "word")?.supportedFileExtensions?.includes("xlsx"));
});

test("discovers installed browsers on Windows, macOS, and Linux with format-specific support", async () => {
  const chromePath = "C:\\Browsers\\Chrome\\chrome.exe";
  const [windows, macos, linux] = await Promise.all([
    detectWindowsApps(undefined, {
      env: {},
      exists: async (candidate) => candidate === chromePath,
      run: async (_command, args) => {
        if (args[1]?.endsWith("App Paths\\chrome.exe")) {
          return { stdout: `(Default)    REG_SZ    ${chromePath}\r\n`, stderr: "" };
        }
        throw new Error("not found");
      },
    }),
    detectMacOSApps(undefined, {
      home: "/Users/me",
      exists: async (candidate) => candidate === "/Applications/Safari.app",
      run: async () => {
        throw new Error("not found");
      },
    }),
    detectLinuxApps(undefined, {
      env: { PATH: "/usr/bin", XDG_DATA_HOME: "/missing", XDG_DATA_DIRS: "/missing" },
      home: "/missing",
      exists: async (candidate) => candidate === "/usr/bin/firefox",
      run: async () => {
        throw new Error("not found");
      },
    }),
  ]);
  for (const [apps, id] of [
    [windows, "chrome"],
    [macos, "safari"],
    [linux, "firefox"],
  ] as const) {
    assert.deepEqual(
      apps
        .filter((app) => app.kind === "browser")
        .map((app) => ({
          id: app.id,
          supportedFileKinds: app.supportedFileKinds,
          targetMode: app.targetMode,
        })),
      [{ id, supportedFileKinds: ["html", "pdf"], targetMode: "path" }],
    );
  }
});

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

test("Linux exposes installed media players with their supported file kinds", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-local-app-media-"));
  const applications = path.join(root, "applications");
  const mpv = path.join(applications, "mpv.desktop");
  const vlc = path.join(applications, "vlc.desktop");
  await mkdir(applications);
  await writeFile(mpv, "[Desktop Entry]\nName=mpv\nExec=/usr/bin/mpv %F\nType=Application\n");
  await writeFile(vlc, "[Desktop Entry]\nName=VLC\nExec=/usr/bin/vlc %F\nType=Application\n");
  t.after(() => rm(root, { recursive: true, force: true }));

  const apps = await detectLinuxApps(undefined, {
    env: { PATH: "/usr/bin", XDG_DATA_HOME: root, XDG_DATA_DIRS: root },
    home: root,
    exists: async (candidate) =>
      candidate === mpv || candidate === vlc || candidate === "/usr/bin/gio",
    run: async () => {
      throw new Error("not found");
    },
  });

  assert.deepEqual(
    apps.map(({ id, name, icon, supportedFileKinds }) => ({
      id,
      name,
      icon,
      supportedFileKinds,
    })),
    [
      {
        id: "mpv",
        name: "mpv Media Player",
        icon: "mpv",
        supportedFileKinds: ["audio", "video"],
      },
      {
        id: "vlc",
        name: "VLC media player",
        icon: "vlc",
        supportedFileKinds: ["audio", "video"],
      },
      {
        id: "file-manager",
        name: "File Manager",
        icon: "file-manager",
        supportedFileKinds: [],
      },
    ],
  );
});
