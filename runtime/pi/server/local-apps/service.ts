import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { LocalAppOpenValue, LocalAppsListValue } from "@/runtime/pi/contracts/rpc";
import { RpcDomainError } from "../core/rpc-domain-error";
import { detectInstalledApps } from "./detectors/index";
import { launchLocalApp } from "./launchers/index";
import type {
  DetectedLocalApp,
  LocalAppDetector,
  LocalAppLaunchTarget,
  LocalAppLauncherFunction,
} from "./types";

export type LocalAppServiceErrorCode =
  | "local-app-not-found"
  | "local-app-target-unreadable"
  | "local-app-launch-failed";

export class LocalAppServiceError extends RpcDomainError<
  LocalAppServiceErrorCode,
  Record<string, string>
> {
  readonly code: LocalAppServiceErrorCode;
  readonly details: Record<string, string>;

  constructor(code: LocalAppServiceErrorCode, details: Record<string, string>, message: string) {
    super(message);
    this.name = "LocalAppServiceError";
    this.code = code;
    this.details = details;
  }
}

export interface LocalAppServiceInternals {
  detect?: LocalAppDetector;
  launch?: LocalAppLauncherFunction;
}

/** Renderer-safe Local App capabilities exposed to transport. */
export interface LocalAppProtocol {
  list(signal?: AbortSignal): Promise<LocalAppsListValue>;
  refresh(signal?: AbortSignal): Promise<LocalAppsListValue>;
  open(appId: string, requestedTarget: string, signal?: AbortSignal): Promise<LocalAppOpenValue>;
}

async function canonicalLaunchTarget(
  requestedPath: string,
  signal?: AbortSignal,
): Promise<LocalAppLaunchTarget> {
  const normalized = path.resolve(requestedPath);
  try {
    signal?.throwIfAborted();
    const canonical = await realpath(normalized);
    signal?.throwIfAborted();
    const metadata = await stat(canonical);
    signal?.throwIfAborted();
    return {
      path: canonical,
      directory: metadata.isDirectory() ? canonical : path.dirname(canonical),
    };
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    throw new LocalAppServiceError(
      "local-app-target-unreadable",
      { path: normalized },
      `Unable to open local application target: ${normalized}`,
    );
  }
}

function view(app: DetectedLocalApp) {
  return {
    id: app.id,
    name: app.name,
    kind: app.kind,
    ...(app.icon ? { icon: app.icon } : {}),
    supportedFileKinds: [...app.supportedFileKinds],
  };
}

export class LocalAppService implements LocalAppProtocol {
  private apps: DetectedLocalApp[] | undefined;
  private detection: Promise<DetectedLocalApp[]> | undefined;
  private readonly detect: LocalAppDetector;
  private readonly launch: LocalAppLauncherFunction;

  constructor(internals: LocalAppServiceInternals = {}) {
    this.detect = internals.detect ?? detectInstalledApps;
    this.launch = internals.launch ?? launchLocalApp;
  }

  async list(signal?: AbortSignal): Promise<LocalAppsListValue> {
    if (!this.apps) {
      this.detection ??= this.detect(signal).finally(() => {
        this.detection = undefined;
      });
      this.apps = await this.detection;
    }
    return { apps: this.apps.map(view) };
  }

  async refresh(signal?: AbortSignal): Promise<LocalAppsListValue> {
    this.apps = undefined;
    this.detection = undefined;
    return this.list(signal);
  }

  async open(
    appId: string,
    requestedTarget: string,
    signal?: AbortSignal,
  ): Promise<LocalAppOpenValue> {
    await this.list(signal);
    const app = this.apps?.find((candidate) => candidate.id === appId);
    if (!app) {
      throw new LocalAppServiceError(
        "local-app-not-found",
        { appId },
        `Local application is not available: ${appId}`,
      );
    }
    const target = await canonicalLaunchTarget(requestedTarget, signal);
    try {
      signal?.throwIfAborted();
      await this.launch(app, target);
      return { opened: true };
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      throw new LocalAppServiceError(
        "local-app-launch-failed",
        { appId, path: target.path },
        `Unable to launch local application: ${app.name}`,
      );
    }
  }
}

export const localAppService = new LocalAppService();
