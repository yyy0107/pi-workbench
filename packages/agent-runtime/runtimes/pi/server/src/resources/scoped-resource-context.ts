import {
  DefaultResourceLoader,
  getAgentDir,
  SettingsManager,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";

import type { PiResourceCatalogTarget } from "@workbench/agent-runtime-pi-protocol/rpc";
import { RpcDomainError } from "@workbench/server-core/rpc-domain-error";
import { getProjectTrustService } from "../trust/project-trust-service";
import { getWorkspaceStore } from "../workspaces/workspace-registry";
import {
  prepareWorkbenchPiExtensions,
  workbenchInternalPiExtensions,
} from "../internal-extensions/index";

export interface ScopedResourceContextErrorDetails {
  "workspace-not-found": { workspaceId: string };
  "resource-catalog-load-failed": { scope: "user" | "project"; workspaceId?: string };
}

export type ScopedResourceContextErrorCode = keyof ScopedResourceContextErrorDetails;

export class ScopedResourceContextError<
  Code extends ScopedResourceContextErrorCode = ScopedResourceContextErrorCode,
> extends RpcDomainError<Code, ScopedResourceContextErrorDetails[Code]> {
  readonly code: Code;
  readonly details: ScopedResourceContextErrorDetails[Code];

  constructor(
    code: Code,
    message: string,
    details: ScopedResourceContextErrorDetails[Code],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ScopedResourceContextError";
    this.code = code;
    this.details = details;
  }
}

export interface ScopedResourceContext {
  readonly target: PiResourceCatalogTarget;
  readonly cwd: string;
  readonly settingsManager: SettingsManager;
  readonly resourceLoader: ResourceLoader;
  reload(): Promise<void>;
}

export interface ScopedResourceContextServiceDependencies {
  getWorkspace(workspaceId: string): Promise<{ path: string } | undefined>;
  isProjectTrusted(workspacePath: string): boolean | Promise<boolean>;
  agentDir(): string;
  applicationCwd(): string;
}

function targetKey(target: PiResourceCatalogTarget): string {
  return target.scope === "user" ? "user" : `project:${target.workspaceId}`;
}

async function getWorkspace(workspaceId: string): Promise<{ path: string } | undefined> {
  const { items } = await getWorkspaceStore().list();
  return items.find((workspace) => workspace.workspaceId === workspaceId);
}

/**
 * Owns application/project resource discovery without creating an AgentSession. Contexts are
 * cached per Toolbox scope so opening several capability details does not repeatedly execute Pi
 * extension discovery.
 */
export class ScopedResourceContextService {
  private readonly dependencies: ScopedResourceContextServiceDependencies;
  private readonly contexts = new Map<string, Promise<ScopedResourceContext>>();

  constructor(dependencies: Partial<ScopedResourceContextServiceDependencies> = {}) {
    this.dependencies = {
      getWorkspace,
      isProjectTrusted: (workspacePath) => getProjectTrustService().isTrusted(workspacePath),
      agentDir: getAgentDir,
      applicationCwd: () => process.cwd(),
      ...dependencies,
    };
  }

  get(target: PiResourceCatalogTarget): Promise<ScopedResourceContext> {
    const key = targetKey(target);
    const existing = this.contexts.get(key);
    if (existing) return existing;

    const pending = this.create(target).catch((error) => {
      this.contexts.delete(key);
      throw error;
    });
    this.contexts.set(key, pending);
    return pending;
  }

  async reload(target: PiResourceCatalogTarget): Promise<void> {
    const context = await this.get(target);
    await context.reload();
  }

  async reloadIfPresent(target: PiResourceCatalogTarget): Promise<void> {
    const context = this.contexts.get(targetKey(target));
    if (context) await (await context).reload();
  }

  invalidate(target?: PiResourceCatalogTarget): void {
    if (target) this.contexts.delete(targetKey(target));
    else this.contexts.clear();
  }

  private async create(target: PiResourceCatalogTarget): Promise<ScopedResourceContext> {
    try {
      const workspace =
        target.scope === "project"
          ? await this.dependencies.getWorkspace(target.workspaceId)
          : undefined;
      if (target.scope === "project" && !workspace) {
        throw new ScopedResourceContextError(
          "workspace-not-found",
          "The workspace does not exist.",
          { workspaceId: target.workspaceId },
        );
      }

      const cwd = workspace?.path ?? this.dependencies.applicationCwd();
      const projectTrusted =
        target.scope === "project" && workspace
          ? await this.dependencies.isProjectTrusted(workspace.path)
          : false;
      const agentDir = this.dependencies.agentDir();
      const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted });
      const resourceLoader = new DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager,
        noContextFiles: true,
        noThemes: true,
        extensionFactories: workbenchInternalPiExtensions,
        extensionsOverride: prepareWorkbenchPiExtensions,
      });
      const reload = () =>
        resourceLoader.reload({
          resolveProjectTrust: async () => projectTrusted,
        });
      await reload();

      return {
        target: { ...target },
        cwd,
        settingsManager,
        resourceLoader,
        reload,
      };
    } catch (error) {
      if (error instanceof ScopedResourceContextError) throw error;
      throw new ScopedResourceContextError(
        "resource-catalog-load-failed",
        "The Pi resource catalog could not be loaded.",
        {
          scope: target.scope,
          ...(target.scope === "project" ? { workspaceId: target.workspaceId } : {}),
        },
        { cause: error },
      );
    }
  }
}

let sharedService: ScopedResourceContextService | undefined;

export function getScopedResourceContextService(): ScopedResourceContextService {
  sharedService ??= new ScopedResourceContextService();
  return sharedService;
}
