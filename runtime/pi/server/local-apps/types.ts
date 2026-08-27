import type {
  LocalAppFileKind,
  LocalAppKind,
  LocalAppPlatform,
  LocalAppView,
} from "@/runtime/pi/contracts/rpc";

export type LocalAppTargetMode = "path" | "directory";

export interface WindowsLocalAppDefinition {
  executables?: readonly string[];
  appPaths?: readonly string[];
  uninstallNames?: readonly string[];
  uninstallNameExcludes?: readonly string[];
  knownPaths?: readonly string[];
  toolbox?: boolean;
}

export interface MacOSLocalAppDefinition {
  bundleIds?: readonly string[];
  appNames?: readonly string[];
  knownPaths?: readonly string[];
}

export interface LinuxLocalAppDefinition {
  executables?: readonly string[];
  desktopIds?: readonly string[];
  desktopIdPrefixes?: readonly string[];
  flatpakIds?: readonly string[];
}

export interface LocalAppDefinition extends LocalAppView {
  targetMode?: LocalAppTargetMode;
  windows?: WindowsLocalAppDefinition;
  macos?: MacOSLocalAppDefinition;
  linux?: LinuxLocalAppDefinition;
}

export type LocalAppLauncher =
  | {
      type: "executable";
      path: string;
    }
  | {
      type: "mac-bundle";
      bundleId: string;
    }
  | {
      type: "mac-app";
      path: string;
    }
  | {
      type: "desktop-entry";
      command: string;
      desktopId: string;
      path: string;
    }
  | {
      type: "flatpak";
      command: string;
      applicationId: string;
    }
  | {
      type: "default";
    };

export interface DetectedLocalApp extends LocalAppView {
  platform: LocalAppPlatform;
  targetMode: LocalAppTargetMode;
  launcher: LocalAppLauncher;
}

export interface LocalAppLaunchTarget {
  path: string;
  directory: string;
}

export type LocalAppDetector = (signal?: AbortSignal) => Promise<DetectedLocalApp[]>;

export type LocalAppLauncherFunction = (
  app: DetectedLocalApp,
  target: LocalAppLaunchTarget,
) => Promise<void>;

export type { LocalAppFileKind, LocalAppKind, LocalAppPlatform, LocalAppView };
