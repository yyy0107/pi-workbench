import type { LocalAppDefinition } from "./types";

export const APP_REGISTRY: readonly LocalAppDefinition[] = [
  {
    id: "vscode",
    name: "VS Code",
    kind: "editor",
    icon: "vscode",
    windows: {
      executables: ["Code.exe", "code.cmd"],
      appPaths: ["Code.exe"],
      uninstallNames: ["Microsoft Visual Studio Code"],
      knownPaths: [
        "%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe",
        "%ProgramFiles%\\Microsoft VS Code\\Code.exe",
      ],
    },
    macos: {
      bundleIds: ["com.microsoft.VSCode"],
      appNames: ["Visual Studio Code"],
    },
    linux: {
      executables: ["code"],
      desktopIds: ["code.desktop", "com.visualstudio.code.desktop"],
      flatpakIds: ["com.visualstudio.code"],
    },
  },
  {
    id: "cursor",
    name: "Cursor",
    kind: "editor",
    icon: "cursor",
    windows: {
      executables: ["Cursor.exe", "cursor.cmd"],
      appPaths: ["Cursor.exe"],
      uninstallNames: ["Cursor"],
      knownPaths: ["%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe"],
    },
    macos: {
      bundleIds: ["com.todesktop.230313mzl4w4u92"],
      appNames: ["Cursor"],
    },
    linux: {
      executables: ["cursor"],
      desktopIds: ["cursor.desktop", "Cursor.desktop"],
    },
  },
  {
    id: "trae",
    name: "Trae",
    kind: "editor",
    icon: "trae",
    windows: {
      executables: ["Trae.exe", "trae.exe", "trae.cmd"],
      appPaths: ["Trae.exe"],
      uninstallNames: ["Trae"],
      uninstallNameExcludes: ["Trae CN"],
      knownPaths: ["%LOCALAPPDATA%\\Programs\\Trae\\Trae.exe", "%ProgramFiles%\\Trae\\Trae.exe"],
    },
    macos: {
      bundleIds: ["com.trae.app"],
      appNames: ["Trae"],
    },
    linux: {
      executables: ["trae"],
      desktopIds: ["trae.desktop"],
    },
  },
  {
    id: "trae-cn",
    name: "Trae CN",
    kind: "editor",
    icon: "trae",
    windows: {
      executables: ["Trae CN.exe", "trae-cn.exe", "trae-cn.cmd"],
      appPaths: ["Trae CN.exe"],
      uninstallNames: ["Trae CN"],
      knownPaths: [
        "%LOCALAPPDATA%\\Programs\\Trae CN\\Trae CN.exe",
        "%ProgramFiles%\\Trae CN\\Trae CN.exe",
      ],
    },
    macos: {
      bundleIds: ["cn.trae.app"],
      appNames: ["Trae CN"],
    },
    linux: {
      executables: ["trae-cn"],
      desktopIds: ["trae-cn.desktop"],
    },
  },
  {
    id: "qoder",
    name: "Qoder",
    kind: "editor",
    icon: "qoder",
    windows: {
      executables: ["Qoder.exe", "qoder.exe", "qoder.cmd"],
      appPaths: ["Qoder.exe"],
      uninstallNames: ["Qoder"],
      knownPaths: [
        "%LOCALAPPDATA%\\Programs\\Qoder\\Qoder.exe",
        "%ProgramFiles%\\Qoder\\Qoder.exe",
      ],
    },
    macos: {
      bundleIds: ["com.qoder.ide"],
      appNames: ["Qoder"],
    },
    linux: {
      executables: ["qoder"],
      desktopIds: ["qoder.desktop"],
    },
  },
  {
    id: "idea",
    name: "IntelliJ IDEA",
    kind: "editor",
    icon: "idea",
    windows: {
      executables: ["idea64.exe", "idea.exe"],
      uninstallNames: ["IntelliJ IDEA"],
      toolbox: true,
    },
    macos: {
      bundleIds: ["com.jetbrains.intellij", "com.jetbrains.intellij.ce"],
      appNames: ["IntelliJ IDEA", "IntelliJ IDEA CE"],
    },
    linux: {
      executables: ["idea", "idea.sh"],
      desktopIds: ["jetbrains-idea.desktop", "jetbrains-idea-ce.desktop"],
      desktopIdPrefixes: ["jetbrains-idea"],
      flatpakIds: ["com.jetbrains.IntelliJ-IDEA-Ultimate", "com.jetbrains.IntelliJ-IDEA-Community"],
    },
  },
  {
    id: "datagrip",
    name: "DataGrip",
    kind: "editor",
    icon: "datagrip",
    windows: {
      executables: ["datagrip64.exe", "datagrip.exe"],
      uninstallNames: ["DataGrip"],
      toolbox: true,
    },
    macos: {
      bundleIds: ["com.jetbrains.datagrip"],
      appNames: ["DataGrip"],
    },
    linux: {
      executables: ["datagrip", "datagrip.sh"],
      desktopIds: ["jetbrains-datagrip.desktop"],
      desktopIdPrefixes: ["jetbrains-datagrip"],
      flatpakIds: ["com.jetbrains.DataGrip"],
    },
  },
  {
    id: "pycharm",
    name: "PyCharm",
    kind: "editor",
    icon: "pycharm",
    windows: {
      executables: ["pycharm64.exe", "pycharm.exe"],
      uninstallNames: ["PyCharm"],
      toolbox: true,
    },
    macos: {
      bundleIds: ["com.jetbrains.pycharm", "com.jetbrains.pycharm.ce"],
      appNames: ["PyCharm", "PyCharm CE"],
    },
    linux: {
      executables: ["pycharm", "pycharm.sh"],
      desktopIds: ["jetbrains-pycharm.desktop", "jetbrains-pycharm-ce.desktop"],
      desktopIdPrefixes: ["jetbrains-pycharm"],
      flatpakIds: ["com.jetbrains.PyCharm-Professional", "com.jetbrains.PyCharm-Community"],
    },
  },
  {
    id: "webstorm",
    name: "WebStorm",
    kind: "editor",
    icon: "webstorm",
    windows: {
      executables: ["webstorm64.exe", "webstorm.exe"],
      uninstallNames: ["WebStorm"],
      toolbox: true,
    },
    macos: {
      bundleIds: ["com.jetbrains.WebStorm"],
      appNames: ["WebStorm"],
    },
    linux: {
      executables: ["webstorm", "webstorm.sh"],
      desktopIds: ["jetbrains-webstorm.desktop"],
      desktopIdPrefixes: ["jetbrains-webstorm"],
      flatpakIds: ["com.jetbrains.WebStorm"],
    },
  },
  {
    id: "terminal",
    name: "Terminal",
    kind: "terminal",
    icon: "terminal",
    targetMode: "directory",
    windows: {
      executables: ["wt.exe", "wt", "pwsh.exe", "powershell.exe", "cmd.exe"],
      appPaths: ["wt.exe"],
    },
    macos: {
      bundleIds: ["com.apple.Terminal"],
      appNames: ["Terminal"],
      knownPaths: ["/System/Applications/Utilities/Terminal.app"],
    },
    linux: {
      executables: ["ghostty", "wezterm", "kitty", "alacritty", "gnome-terminal", "konsole"],
    },
  },
];

export const FILE_MANAGER_APP: LocalAppDefinition = {
  id: "file-manager",
  name: "File Manager",
  kind: "file-manager",
  icon: "file-manager",
  targetMode: "directory",
};
