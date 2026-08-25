import {
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
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
} from "../../rpc-contracts";
import { getOrStartSession } from "../sessions/session-registry";
import { getProjectTrustService } from "../trust/project-trust-service";
import { getWorkspaceStore } from "../workspaces/workspace-registry";

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

export interface InstalledPackageServiceDependencies {
  getSession(sessionId: string): Promise<InstalledPackageSessionHost>;
  getWorkspace(workspaceId: string): Promise<{ path: string } | undefined>;
  isProjectTrusted(workspacePath: string): boolean | Promise<boolean>;
  installUserPackage(sessionId: string, source: string): Promise<void>;
  installProjectPackage(workspacePath: string, source: string): Promise<void>;
  removeUserPackage(sessionId: string, source: string): Promise<boolean>;
  removeProjectPackage(workspacePath: string, source: string): Promise<boolean>;
}

export interface InstalledPackageServiceErrorDetails {
  "session-not-found": { sessionId: string };
  "workspace-not-found": { workspaceId: string };
  "project-untrusted": { workspaceId: string };
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

async function installUserPackage(sessionId: string, source: string): Promise<void> {
  const host = await getOrStartSession(sessionId);
  const session = host.session;
  const packageManager = new DefaultPackageManager({
    cwd: session.sessionManager.getCwd(),
    agentDir: getAgentDir(),
    settingsManager: session.settingsManager,
  });
  await packageManager.installAndPersist(source);
  await session.settingsManager.flush();
  const settingsError = session.settingsManager.drainErrors()[0];
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

async function removeUserPackage(sessionId: string, source: string): Promise<boolean> {
  const host = await getOrStartSession(sessionId);
  const session = host.session;
  if (!hasConfiguredSource(session.settingsManager.getGlobalSettings(), source)) return false;
  const packageManager = new DefaultPackageManager({
    cwd: session.sessionManager.getCwd(),
    agentDir: getAgentDir(),
    settingsManager: session.settingsManager,
  });
  const removed = await packageManager.removeAndPersist(source);
  await session.settingsManager.flush();
  const settingsError = session.settingsManager.drainErrors()[0];
  if (settingsError) throw settingsError.error;
  return removed;
}

async function removeProjectPackage(workspacePath: string, source: string): Promise<boolean> {
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(workspacePath, agentDir, {
    projectTrusted: true,
  });
  if (!hasConfiguredSource(settingsManager.getProjectSettings(), source)) return false;
  const packageManager = new DefaultPackageManager({
    cwd: workspacePath,
    agentDir,
    settingsManager,
  });
  const removed = await packageManager.removeAndPersist(source, { local: true });
  await settingsManager.flush();
  const settingsError = settingsManager.drainErrors()[0];
  if (settingsError) throw settingsError.error;
  return removed;
}

export class InstalledPackageService {
  private readonly dependencies: InstalledPackageServiceDependencies;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(dependencies: Partial<InstalledPackageServiceDependencies> = {}) {
    this.dependencies = {
      getSession: getOrStartSession,
      getWorkspace,
      isProjectTrusted: (workspacePath) => getProjectTrustService().isTrusted(workspacePath),
      installUserPackage,
      installProjectPackage,
      removeUserPackage,
      removeProjectPackage,
      ...dependencies,
    };
  }

  private async serializeMutation<Value>(operation: () => Promise<Value>): Promise<Value> {
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async list({ sessionId }: InstalledPackageListPayload): Promise<InstalledPackageListValue> {
    let host: InstalledPackageSessionHost;
    try {
      host = await this.dependencies.getSession(sessionId);
    } catch (error) {
      if (errorCode(error) === "pi_session_not_found") {
        throw new InstalledPackageServiceError(
          "session-not-found",
          "The session does not exist.",
          { sessionId },
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
      return {
        packages: [
          ...(settings.getGlobalSettings().packages ?? []).map((source) =>
            packageView(source, "user"),
          ),
          ...(settings.getProjectSettings().packages ?? []).map((source) =>
            packageView(source, "project"),
          ),
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
        await this.serializeMutation(() =>
          this.dependencies.installProjectPackage(workspace.path, source),
        );
        return {
          source,
          scope: "project",
          workspaceId: target.workspaceId,
          reloadRequired: true,
        };
      } catch (error) {
        throw new InstalledPackageServiceError(
          "install-failed",
          "The Pi package could not be installed.",
          { name, scope: "project" },
          { cause: error },
        );
      }
    }

    try {
      await this.serializeMutation(() =>
        this.dependencies.installUserPackage(target.sessionId, source),
      );
      return { source, scope: "user", reloadRequired: true };
    } catch (error) {
      if (errorCode(error) === "pi_session_not_found") {
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
        const removed = await this.serializeMutation(() =>
          this.dependencies.removeProjectPackage(workspace.path, source),
        );
        if (!removed) {
          throw new InstalledPackageServiceError(
            "package-not-installed",
            "The Pi package is not installed in this project.",
            { source, scope: "project" },
          );
        }
        return {
          source,
          scope: "project",
          workspaceId: target.workspaceId,
          reloadRequired: true,
        };
      } catch (error) {
        if (error instanceof InstalledPackageServiceError) throw error;
        throw new InstalledPackageServiceError(
          "remove-failed",
          "The Pi package could not be removed.",
          { source, scope: "project" },
          { cause: error },
        );
      }
    }

    try {
      const removed = await this.serializeMutation(() =>
        this.dependencies.removeUserPackage(target.sessionId, source),
      );
      if (!removed) {
        throw new InstalledPackageServiceError(
          "package-not-installed",
          "The Pi package is not installed for this user.",
          { source, scope: "user" },
        );
      }
      return { source, scope: "user", reloadRequired: true };
    } catch (error) {
      if (error instanceof InstalledPackageServiceError) throw error;
      if (errorCode(error) === "pi_session_not_found") {
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
