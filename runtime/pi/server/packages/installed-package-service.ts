import { open } from "node:fs/promises";
import { join } from "node:path";

import {
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
  type PackageManager,
  type PackageSource,
} from "@earendil-works/pi-coding-agent";

import type {
  InstalledPackageDescribePayload,
  InstalledPackageDetailsView,
  InstalledPackageListPayload,
  InstalledPackageListValue,
  InstalledPackageView,
  PiPackageInstallPayload,
  PiPackageInstallValue,
  PiPackageRemovePayload,
  PiPackageRemoveValue,
  PiPackageUpdatePayload,
  PiPackageUpdateValue,
  PiPackageUpdatesPayload,
  PiPackageUpdatesValue,
  PiPackageResourceType,
  PiResourceCatalogTarget,
} from "@/runtime/pi/contracts/rpc";
import { RpcDomainError } from "../core/rpc-domain-error";
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
  updateUserPackage(sessionId: string | undefined, source: string): Promise<boolean>;
  updateProjectPackage(workspacePath: string, source: string): Promise<boolean>;
  prepareUserPackageRemoval(
    sessionId: string | undefined,
    source: string,
  ): Promise<PackageRemovalCleanup | undefined>;
  prepareProjectPackageRemoval(
    workspacePath: string,
    source: string,
  ): Promise<PackageRemovalCleanup | undefined>;
  describeInstalledPackage(
    request: InstalledPackageDescribePayload,
  ): Promise<InstalledPackageDetailsView>;
  checkAvailablePackageUpdates(request: PiPackageUpdatesPayload): Promise<PiPackageUpdatesValue>;
  mutationCoordinator: PiResourceMutationCoordinator;
  reloadScopedResources(target: PiResourceCatalogTarget): Promise<void>;
}

/** Stable transport-facing Package operations; Pi SDK ownership stays in this service. */
export interface InstalledPackageProtocol {
  list(request: InstalledPackageListPayload): Promise<InstalledPackageListValue>;
  describe(request: InstalledPackageDescribePayload): Promise<InstalledPackageDetailsView>;
  updates(request: PiPackageUpdatesPayload): Promise<PiPackageUpdatesValue>;
  install(request: PiPackageInstallPayload): Promise<PiPackageInstallValue>;
  update(request: PiPackageUpdatePayload): Promise<PiPackageUpdateValue>;
  remove(request: PiPackageRemovePayload): Promise<PiPackageRemoveValue>;
}

export type PackageRemovalCleanup = () => Promise<void>;

export interface InstalledPackageServiceErrorDetails {
  "session-not-found": { sessionId: string };
  "workspace-not-found": { workspaceId: string };
  "project-untrusted": { workspaceId: string };
  "session-busy": { sessionId: string };
  "install-failed": { name: string; scope: "user" | "project" };
  "update-failed": { source: string; scope: "user" | "project" };
  "package-not-installed": { source: string; scope: "user" | "project" };
  "package-details-unavailable": { source: string; scope: "user" | "project" };
  "remove-failed": { source: string; scope: "user" | "project" };
  internal: Record<string, never>;
}

export type InstalledPackageServiceErrorCode = keyof InstalledPackageServiceErrorDetails;

export class InstalledPackageServiceError<
  Code extends InstalledPackageServiceErrorCode = InstalledPackageServiceErrorCode,
> extends RpcDomainError<Code, InstalledPackageServiceErrorDetails[Code]> {
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

const MAX_INSTALLED_PACKAGE_JSON_BYTES = 1024 * 1024;
const MAX_INSTALLED_PACKAGE_MANIFEST_BYTES = 256 * 1024;
const PI_MANIFEST_RESOURCE_FIELDS = ["extensions", "skills", "prompts", "themes"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function metadataString(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maximumLength);
}

function packageAuthor(value: unknown): string | undefined {
  if (typeof value === "string") return metadataString(value, 512);
  return isRecord(value) ? metadataString(value.name, 512) : undefined;
}

function packageResourceTypes(manifest: unknown): PiPackageResourceType[] {
  if (!isRecord(manifest)) return ["package"];
  const types = PI_MANIFEST_RESOURCE_FIELDS.flatMap((field) => {
    const entries = manifest[field];
    return Array.isArray(entries) && entries.length > 0
      ? [field.slice(0, -1) as PiPackageResourceType]
      : [];
  });
  return types.length > 0 ? types : ["package"];
}

function dependencyCount(value: unknown): number {
  return isRecord(value) ? Object.keys(value).length : 0;
}

/** Parses only the safe fields shown by Workbench from an installed package.json snapshot. */
export function parseInstalledPackageDetails(
  packageJson: string,
  identity: Pick<InstalledPackageDetailsView, "source" | "scope">,
): InstalledPackageDetailsView {
  const parsed = JSON.parse(packageJson) as unknown;
  if (!isRecord(parsed)) throw new TypeError("Expected an object package manifest.");

  const manifest = parsed.pi;
  const serializedManifest = isRecord(manifest) ? JSON.stringify(manifest, null, 2) : undefined;
  const manifestJson =
    serializedManifest &&
    Buffer.byteLength(serializedManifest, "utf8") <= MAX_INSTALLED_PACKAGE_MANIFEST_BYTES
      ? serializedManifest
      : undefined;

  const name = metadataString(parsed.name, 512);
  const version = metadataString(parsed.version, 256);
  const description = metadataString(parsed.description, 8_192);
  const author = packageAuthor(parsed.author);
  const license = metadataString(parsed.license, 256);

  return {
    ...identity,
    ...(name ? { name } : {}),
    ...(version ? { version } : {}),
    ...(description ? { description } : {}),
    ...(author ? { author } : {}),
    ...(license ? { license } : {}),
    types: packageResourceTypes(manifest),
    dependencyCount: dependencyCount(parsed.dependencies),
    peerDependencyCount: dependencyCount(parsed.peerDependencies),
    ...(manifestJson ? { manifestJson } : {}),
  };
}

async function readInstalledPackageDetails(
  installedPath: string,
  identity: Pick<InstalledPackageDetailsView, "source" | "scope">,
): Promise<InstalledPackageDetailsView> {
  const packageJsonFile = await open(join(installedPath, "package.json"), "r");
  try {
    const stats = await packageJsonFile.stat();
    if (!stats.isFile() || stats.size > MAX_INSTALLED_PACKAGE_JSON_BYTES) {
      throw new RangeError("Installed package.json is unavailable or too large.");
    }
    const packageJson = await packageJsonFile.readFile("utf8");
    if (Buffer.byteLength(packageJson, "utf8") > MAX_INSTALLED_PACKAGE_JSON_BYTES) {
      throw new RangeError("Installed package.json is too large.");
    }
    return parseInstalledPackageDetails(packageJson, identity);
  } finally {
    await packageJsonFile.close();
  }
}

async function describeInstalledPackage(
  request: InstalledPackageDescribePayload,
): Promise<InstalledPackageDetailsView> {
  const context = await getScopedResourceContextService().get(request.target);
  const packageManager = new DefaultPackageManager({
    cwd: context.cwd,
    agentDir: getAgentDir(),
    settingsManager: context.settingsManager,
  });
  const configuredPackage = packageManager
    .listConfiguredPackages()
    .find(
      (configured) =>
        configured.scope === request.target.scope && configured.source === request.source,
    );
  if (!configuredPackage) {
    throw new InstalledPackageServiceError(
      "package-not-installed",
      "The Pi package is not configured in this scope.",
      { source: request.source, scope: request.target.scope },
    );
  }
  if (!configuredPackage.installedPath) {
    throw new InstalledPackageServiceError(
      "package-details-unavailable",
      "The installed Pi package snapshot is unavailable.",
      { source: request.source, scope: request.target.scope },
    );
  }

  try {
    return await readInstalledPackageDetails(configuredPackage.installedPath, {
      source: request.source,
      scope: request.target.scope,
    });
  } catch (error) {
    throw new InstalledPackageServiceError(
      "package-details-unavailable",
      "The installed Pi package snapshot is unavailable.",
      { source: request.source, scope: request.target.scope },
      { cause: error },
    );
  }
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

function packageUpdateKey(scope: "user" | "project", source: string): string {
  return `${scope}\0${source}`;
}

async function checkAvailablePackageUpdates(
  request: PiPackageUpdatesPayload,
): Promise<PiPackageUpdatesValue> {
  let cwd: string;
  let settingsManager: SettingsManager;
  if ("target" in request && request.target) {
    const context = await getScopedResourceContextService().get(request.target);
    cwd = context.cwd;
    settingsManager = context.settingsManager;
  } else {
    const host = await getOrStartSession(request.sessionId);
    cwd = host.session.sessionManager.getCwd();
    settingsManager = host.session.settingsManager;
  }

  const packageManager = new DefaultPackageManager({
    cwd,
    agentDir: getAgentDir(),
    settingsManager,
  });
  const availableUpdates = await packageManager.checkForAvailableUpdates();
  const configuredPackages = [
    ...(settingsManager.getGlobalSettings().packages ?? []).map((source) =>
      packageView(source, "user"),
    ),
    ...(settingsManager.getProjectSettings().packages ?? []).map((source) =>
      packageView(source, "project"),
    ),
  ];
  const filteredByPackage = new Map(
    configuredPackages.map((item) => [packageUpdateKey(item.scope, item.source), item.filtered]),
  );
  const requestedScope = "target" in request && request.target ? request.target.scope : undefined;

  return {
    updates: availableUpdates
      .filter((update) => requestedScope === undefined || update.scope === requestedScope)
      .map((update) => ({
        source: update.source,
        displayName: update.displayName,
        type: update.type,
        scope: update.scope,
        filtered: filteredByPackage.get(packageUpdateKey(update.scope, update.source)) ?? false,
      })),
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

async function updateConfiguredPackage(
  packageManager: Pick<PackageManager, "install">,
  settings: PackageSettingsSnapshot,
  source: string,
  options?: { local?: boolean },
): Promise<boolean> {
  if (!hasConfiguredSource(settings, source)) return false;

  // PackageManager.update(source) expands a matching package identity across
  // both settings scopes. Reinstalling an already-configured source preserves
  // its filters while updating only the explicitly selected install root.
  await packageManager.install(source, options);
  return true;
}

async function updateUserPackage(sessionId: string | undefined, source: string): Promise<boolean> {
  const { cwd, settingsManager } = await userPackageSettings(sessionId);
  const packageManager = new DefaultPackageManager({
    cwd,
    agentDir: getAgentDir(),
    settingsManager,
  });
  return updateConfiguredPackage(packageManager, settingsManager.getGlobalSettings(), source);
}

async function updateProjectPackage(workspacePath: string, source: string): Promise<boolean> {
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(workspacePath, agentDir, {
    projectTrusted: true,
  });
  const packageManager = new DefaultPackageManager({
    cwd: workspacePath,
    agentDir,
    settingsManager,
  });
  return updateConfiguredPackage(packageManager, settingsManager.getProjectSettings(), source, {
    local: true,
  });
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

export class InstalledPackageService implements InstalledPackageProtocol {
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
      updateUserPackage,
      updateProjectPackage,
      prepareUserPackageRemoval,
      prepareProjectPackageRemoval,
      describeInstalledPackage,
      checkAvailablePackageUpdates,
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

  async updates(request: PiPackageUpdatesPayload): Promise<PiPackageUpdatesValue> {
    try {
      return await this.dependencies.checkAvailablePackageUpdates(request);
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
        "Available Pi package updates could not be checked.",
        {},
        { cause: error },
      );
    }
  }

  async describe(request: InstalledPackageDescribePayload): Promise<InstalledPackageDetailsView> {
    try {
      return await this.dependencies.describeInstalledPackage(request);
    } catch (error) {
      if (error instanceof InstalledPackageServiceError) throw error;
      if (error instanceof ScopedResourceContextError) throw error;
      throw new InstalledPackageServiceError(
        "package-details-unavailable",
        "The installed Pi package snapshot is unavailable.",
        { source: request.source, scope: request.target.scope },
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

  async update({ source, target }: PiPackageUpdatePayload): Promise<PiPackageUpdateValue> {
    if (target.scope === "project") {
      let workspace: { path: string } | undefined;
      try {
        workspace = await this.dependencies.getWorkspace(target.workspaceId);
      } catch (error) {
        throw new InstalledPackageServiceError(
          "update-failed",
          "The Pi package could not be updated.",
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
            const updated = await this.dependencies.updateProjectPackage(workspace.path, source);
            if (!updated) {
              throw new InstalledPackageServiceError(
                "package-not-installed",
                "The Pi package is not installed in this project.",
                { source, scope: "project" },
              );
            }
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
          "update-failed",
          "The Pi package could not be updated.",
          { source, scope: "project" },
          { cause: error },
        );
      }
    }

    try {
      await this.dependencies.mutationCoordinator.mutate({ scope: "user" }, async () => {
        const updated = await this.dependencies.updateUserPackage(target.sessionId, source);
        if (!updated) {
          throw new InstalledPackageServiceError(
            "package-not-installed",
            "The Pi package is not installed for this user.",
            { source, scope: "user" },
          );
        }
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
        "update-failed",
        "The Pi package could not be updated.",
        { source, scope: "user" },
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
