import {
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
  type PackageManager,
  type PackageSource,
} from "@earendil-works/pi-coding-agent";

import type {
  InstalledPackageListPayload,
  InstalledPackageListValue,
  InstalledPackageView,
  PiPackageInstallPayload,
  PiPackageInstallValue,
  PiPackageRemovePayload,
  PiPackageRemoveValue,
  PiResourceCatalogTarget,
} from "../../rpc-contracts";
import {
  getPiResourceMutationCoordinator,
  PiResourceMutationBusyError,
  PiResourceMutationCoordinator,
  type LoadedPiResourceMutationSessionHost,
} from "../resources/pi-resource-mutation-coordinator";
import { getLoadedSessions, getOrStartSession } from "../sessions/session-registry";
import { getProjectTrustService } from "../trust/project-trust-service";
import { getWorkspaceStore } from "../workspaces/workspace-registry";
import {
  getScopedResourceContextService,
  ScopedResourceContextError,
} from "../resources/scoped-resource-context";

interface PackageSettingsSnapshot {
  packages?: readonly PackageSource[];
}

export interface InstalledPackageSessionHost {
  session: {
    settingsManager: {
      getGlobalSettings(): PackageSettingsSnapshot;
      getProjectSettings(): PackageSettingsSnapshot;
    };
  };
}

export interface LoadedPackageSessionHost extends LoadedPiResourceMutationSessionHost {
  readonly id: string;
  readonly isRunning: boolean;
  readonly session: {
    readonly sessionManager: {
      getCwd(): string;
    };
    reload(): Promise<void>;
  };
}

export interface InstalledPackageServiceDependencies {
  getSession(sessionId: string): Promise<InstalledPackageSessionHost>;
  getScopedResourceHost(target: PiResourceCatalogTarget): Promise<InstalledPackageSessionHost>;
  getWorkspace(workspaceId: string): Promise<{ path: string } | undefined>;
  getLoadedSessions(): readonly LoadedPackageSessionHost[];
  isProjectTrusted(workspacePath: string): boolean | Promise<boolean>;
  installUserPackage(sessionId: string | undefined, source: string): Promise<void>;
  installProjectPackage(workspacePath: string, source: string): Promise<void>;
  prepareUserPackageRemoval(
    sessionId: string | undefined,
    source: string,
  ): Promise<PackageRemovalCleanup | undefined>;
  prepareProjectPackageRemoval(
    workspacePath: string,
    source: string,
  ): Promise<PackageRemovalCleanup | undefined>;
  mutationCoordinator: PiResourceMutationCoordinator;
  reloadScopedResources(target: PiResourceCatalogTarget): Promise<void>;
}

export type PackageRemovalCleanup = () => Promise<void>;

export interface InstalledPackageServiceErrorDetails {
  "session-not-found": { sessionId: string };
  "workspace-not-found": { workspaceId: string };
  "project-untrusted": { workspaceId: string };
  "session-busy": { sessionId: string };
  "install-failed": { name: string; scope: "user" | "project" };
  "package-not-installed": { source: string; scope: "user" | "project" };
  "remove-failed": { source: string; scope: "user" | "project" };
  internal: Record<string, never>;
}

export type InstalledPackageServiceErrorCode = keyof InstalledPackageServiceErrorDetails;

export class InstalledPackageServiceError<
  Code extends InstalledPackageServiceErrorCode = InstalledPackageServiceErrorCode,
> extends Error {
  readonly code: Code;
  readonly details: InstalledPackageServiceErrorDetails[Code];

  constructor(
    code: Code,
    message: string,
    details: InstalledPackageServiceErrorDetails[Code],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "InstalledPackageServiceError";
    this.code = code;
    this.details = details;
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function packageView(
  source: PackageSource,
  scope: InstalledPackageView["scope"],
): InstalledPackageView {
  return {
    source: typeof source === "string" ? source : source.source,
    scope,
    filtered:
      typeof source === "object" &&
      (source.extensions !== undefined ||
        source.skills !== undefined ||
        source.prompts !== undefined ||
        source.themes !== undefined),
  };
}

async function userPackageSettings(sessionId?: string): Promise<{
  cwd: string;
  settingsManager: SettingsManager;
}> {
  if (sessionId) {
    const host = await getOrStartSession(sessionId);
    return {
      cwd: host.session.sessionManager.getCwd(),
      settingsManager: host.session.settingsManager,
    };
  }
  const cwd = process.cwd();
  return {
    cwd,
    settingsManager: SettingsManager.create(cwd, getAgentDir(), { projectTrusted: false }),
  };
}

async function installUserPackage(sessionId: string | undefined, source: string): Promise<void> {
  const { cwd, settingsManager } = await userPackageSettings(sessionId);
  const packageManager = new DefaultPackageManager({
    cwd,
    agentDir: getAgentDir(),
    settingsManager,
  });
  await packageManager.installAndPersist(source);
  await settingsManager.flush();
  const settingsError = settingsManager.drainErrors()[0];
  if (settingsError) throw settingsError.error;
}

async function getWorkspace(workspaceId: string): Promise<{ path: string } | undefined> {
  const { items } = await getWorkspaceStore().list();
  return items.find((workspace) => workspace.workspaceId === workspaceId);
}

async function installProjectPackage(workspacePath: string, source: string): Promise<void> {
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(workspacePath, agentDir, {
    projectTrusted: true,
  });
  const packageManager = new DefaultPackageManager({
    cwd: workspacePath,
    agentDir,
    settingsManager,
  });
  await packageManager.installAndPersist(source, { local: true });
  await settingsManager.flush();
  const settingsError = settingsManager.drainErrors()[0];
  if (settingsError) throw settingsError.error;
}

function hasConfiguredSource(settings: PackageSettingsSnapshot, source: string): boolean {
  return (settings.packages ?? []).some((entry) =>
    typeof entry === "string" ? entry === source : entry.source === source,
  );
}

async function flushPackageSettings(
  settingsManager: Pick<SettingsManager, "flush" | "drainErrors">,
): Promise<void> {
  await settingsManager.flush();
  const settingsError = settingsManager.drainErrors()[0];
  if (settingsError) throw settingsError.error;
}

async function preparePackageRemoval(
  packageManager: Pick<PackageManager, "remove" | "removeSourceFromSettings">,
  settingsManager: Pick<SettingsManager, "flush" | "drainErrors">,
  source: string,
  options?: { local?: boolean },
): Promise<PackageRemovalCleanup | undefined> {
  const removed = packageManager.removeSourceFromSettings(source, options);
  if (!removed) return undefined;

  // Persist the authoritative configuration before touching package files. A
  // process restart can now leave only harmless orphaned files, rather than a
  // configured-but-missing package that Pi immediately reinstalls on startup.
  await flushPackageSettings(settingsManager);
  return async () => packageManager.remove(source, options);
}

async function prepareUserPackageRemoval(
  sessionId: string | undefined,
  source: string,
): Promise<PackageRemovalCleanup | undefined> {
  const { cwd, settingsManager } = await userPackageSettings(sessionId);
  if (!hasConfiguredSource(settingsManager.getGlobalSettings(), source)) return undefined;
  const packageManager = new DefaultPackageManager({
    cwd,
    agentDir: getAgentDir(),
    settingsManager,
  });
  return preparePackageRemoval(packageManager, settingsManager, source);
}

async function prepareProjectPackageRemoval(
  workspacePath: string,
  source: string,
): Promise<PackageRemovalCleanup | undefined> {
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(workspacePath, agentDir, {
    projectTrusted: true,
  });
  if (!hasConfiguredSource(settingsManager.getProjectSettings(), source)) return undefined;
  const packageManager = new DefaultPackageManager({
    cwd: workspacePath,
    agentDir,
    settingsManager,
  });
  return preparePackageRemoval(packageManager, settingsManager, source, { local: true });
}

export class InstalledPackageService {
  private readonly dependencies: InstalledPackageServiceDependencies;

  constructor(dependencies: Partial<InstalledPackageServiceDependencies> = {}) {
    const mutationCoordinator =
      dependencies.mutationCoordinator ??
      (dependencies.getLoadedSessions
        ? new PiResourceMutationCoordinator({
            getLoadedSessions: dependencies.getLoadedSessions,
          })
        : getPiResourceMutationCoordinator());
    this.dependencies = {
      getSession: getOrStartSession,
      getScopedResourceHost: async (target) => {
        const context = await getScopedResourceContextService().get(target);
        return { session: { settingsManager: context.settingsManager } };
      },
      getWorkspace,
      getLoadedSessions,
      isProjectTrusted: (workspacePath) => getProjectTrustService().isTrusted(workspacePath),
      installUserPackage,
      installProjectPackage,
      prepareUserPackageRemoval,
      prepareProjectPackageRemoval,
      reloadScopedResources: (target) => getScopedResourceContextService().reloadIfPresent(target),
      ...dependencies,
      mutationCoordinator,
    };
  }

  async list(request: InstalledPackageListPayload): Promise<InstalledPackageListValue> {
    let host: InstalledPackageSessionHost;
    try {
      host =
        "target" in request && request.target
          ? await this.dependencies.getScopedResourceHost(request.target)
          : await this.dependencies.getSession(request.sessionId);
    } catch (error) {
      if (error instanceof ScopedResourceContextError) throw error;
      if (!("target" in request) && errorCode(error) === "pi_session_not_found") {
        throw new InstalledPackageServiceError(
          "session-not-found",
          "The session does not exist.",
          { sessionId: request.sessionId },
          { cause: error },
        );
      }
      throw new InstalledPackageServiceError(
        "internal",
        "The installed Pi packages could not be loaded.",
        {},
        { cause: error },
      );
    }

    try {
      const settings = host.session.settingsManager;
      const requestedScope = "target" in request ? request.target?.scope : undefined;
      return {
        packages: [
          ...(requestedScope === "project"
            ? []
            : (settings.getGlobalSettings().packages ?? []).map((source) =>
                packageView(source, "user"),
              )),
          ...(requestedScope === "user"
            ? []
            : (settings.getProjectSettings().packages ?? []).map((source) =>
                packageView(source, "project"),
              )),
        ],
      };
    } catch (error) {
      throw new InstalledPackageServiceError(
        "internal",
        "The installed Pi packages could not be loaded.",
        {},
        { cause: error },
      );
    }
  }

  async install({ name, target }: PiPackageInstallPayload): Promise<PiPackageInstallValue> {
    const source = `npm:${name}`;
    if (target.scope === "project") {
      let workspace: { path: string } | undefined;
      try {
        workspace = await this.dependencies.getWorkspace(target.workspaceId);
      } catch (error) {
        throw new InstalledPackageServiceError(
          "install-failed",
          "The Pi package could not be installed.",
          { name, scope: "project" },
          { cause: error },
        );
      }
      if (!workspace) {
        throw new InstalledPackageServiceError(
          "workspace-not-found",
          "The workspace does not exist.",
          { workspaceId: target.workspaceId },
        );
      }
      if (!(await this.dependencies.isProjectTrusted(workspace.path))) {
        throw new InstalledPackageServiceError(
          "project-untrusted",
          "Project-local Pi resources are not trusted.",
          { workspaceId: target.workspaceId },
        );
      }

      try {
        await this.dependencies.mutationCoordinator.mutate(
          { scope: "project", cwd: workspace.path },
          async () => {
            await this.dependencies.installProjectPackage(workspace.path, source);
            return {
              value: undefined,
              reload: true,
              afterReload: () =>
                this.dependencies.reloadScopedResources({
                  scope: "project",
                  workspaceId: target.workspaceId,
                }),
            };
          },
        );
        return {
          source,
          scope: "project",
          workspaceId: target.workspaceId,
          reloadRequired: false,
        };
      } catch (error) {
        if (error instanceof InstalledPackageServiceError) throw error;
        if (error instanceof PiResourceMutationBusyError) {
          throw new InstalledPackageServiceError(
            "session-busy",
            "A related session is currently running.",
            { sessionId: error.sessionId },
            { cause: error },
          );
        }
        throw new InstalledPackageServiceError(
          "install-failed",
          "The Pi package could not be installed.",
          { name, scope: "project" },
          { cause: error },
        );
      }
    }

    try {
      await this.dependencies.mutationCoordinator.mutate({ scope: "user" }, async () => {
        await this.dependencies.installUserPackage(target.sessionId, source);
        return {
          value: undefined,
          reload: true,
          afterReload: () => this.dependencies.reloadScopedResources({ scope: "user" }),
        };
      });
      return { source, scope: "user", reloadRequired: false };
    } catch (error) {
      if (error instanceof InstalledPackageServiceError) throw error;
      if (error instanceof PiResourceMutationBusyError) {
        throw new InstalledPackageServiceError(
          "session-busy",
          "A related session is currently running.",
          { sessionId: error.sessionId },
          { cause: error },
        );
      }
      if (target.sessionId && errorCode(error) === "pi_session_not_found") {
        throw new InstalledPackageServiceError(
          "session-not-found",
          "The session does not exist.",
          { sessionId: target.sessionId },
          { cause: error },
        );
      }
      throw new InstalledPackageServiceError(
        "install-failed",
        "The Pi package could not be installed.",
        { name, scope: "user" },
        { cause: error },
      );
    }
  }

  async remove({ source, target }: PiPackageRemovePayload): Promise<PiPackageRemoveValue> {
    if (target.scope === "project") {
      let workspace: { path: string } | undefined;
      try {
        workspace = await this.dependencies.getWorkspace(target.workspaceId);
      } catch (error) {
        throw new InstalledPackageServiceError(
          "remove-failed",
          "The Pi package could not be removed.",
          { source, scope: "project" },
          { cause: error },
        );
      }
      if (!workspace) {
        throw new InstalledPackageServiceError(
          "workspace-not-found",
          "The workspace does not exist.",
          { workspaceId: target.workspaceId },
        );
      }
      if (!(await this.dependencies.isProjectTrusted(workspace.path))) {
        throw new InstalledPackageServiceError(
          "project-untrusted",
          "Project-local Pi resources are not trusted.",
          { workspaceId: target.workspaceId },
        );
      }

      try {
        await this.dependencies.mutationCoordinator.mutate(
          { scope: "project", cwd: workspace.path },
          async () => {
            const cleanup = await this.dependencies.prepareProjectPackageRemoval(
              workspace.path,
              source,
            );
            if (!cleanup) {
              throw new InstalledPackageServiceError(
                "package-not-installed",
                "The Pi package is not installed in this project.",
                { source, scope: "project" },
              );
            }
            return {
              value: undefined,
              reload: true,
              afterReload: async () => {
                await cleanup();
                await this.dependencies.reloadScopedResources({
                  scope: "project",
                  workspaceId: target.workspaceId,
                });
              },
            };
          },
        );
        return {
          source,
          scope: "project",
          workspaceId: target.workspaceId,
          reloadRequired: false,
        };
      } catch (error) {
        if (error instanceof InstalledPackageServiceError) throw error;
        if (error instanceof PiResourceMutationBusyError) {
          throw new InstalledPackageServiceError(
            "session-busy",
            "A related session is currently running.",
            { sessionId: error.sessionId },
            { cause: error },
          );
        }
        throw new InstalledPackageServiceError(
          "remove-failed",
          "The Pi package could not be removed.",
          { source, scope: "project" },
          { cause: error },
        );
      }
    }

    try {
      await this.dependencies.mutationCoordinator.mutate({ scope: "user" }, async () => {
        const cleanup = await this.dependencies.prepareUserPackageRemoval(target.sessionId, source);
        if (!cleanup) {
          throw new InstalledPackageServiceError(
            "package-not-installed",
            "The Pi package is not installed for this user.",
            { source, scope: "user" },
          );
        }
        return {
          value: undefined,
          reload: true,
          afterReload: async () => {
            await cleanup();
            await this.dependencies.reloadScopedResources({ scope: "user" });
          },
        };
      });
      return { source, scope: "user", reloadRequired: false };
    } catch (error) {
      if (error instanceof InstalledPackageServiceError) throw error;
      if (error instanceof PiResourceMutationBusyError) {
        throw new InstalledPackageServiceError(
          "session-busy",
          "A related session is currently running.",
          { sessionId: error.sessionId },
          { cause: error },
        );
      }
      if (target.sessionId && errorCode(error) === "pi_session_not_found") {
        throw new InstalledPackageServiceError(
          "session-not-found",
          "The session does not exist.",
          { sessionId: target.sessionId },
          { cause: error },
        );
      }
      throw new InstalledPackageServiceError(
        "remove-failed",
        "The Pi package could not be removed.",
        { source, scope: "user" },
        { cause: error },
      );
    }
  }
}
