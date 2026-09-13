import { getSessionContextTrace } from "@workbench/pi-sdk-sessions/session-context-trace";
import type { ComposerAttachmentService } from "@workbench/agent-runtime-contracts/composer-attachments";
import { getComposerTextAttachmentStore } from "@workbench/pi-sdk-sessions/composer-text-attachments";
import { createComposerAttachmentRpcRoutes } from "../routes/composer-attachment-rpc-routes";
import type { WorkbenchAgentServerAdapter } from "@workbench/agent-runtime-server/adapter";
import type { AgentCommandCatalogPort } from "@workbench/agent-runtime-server/commands";

import type { CommandCatalogProtocol } from "@workbench/pi-sdk-resources/commands";
import { ExtensionService } from "../resource-composition";

import { HostService } from "../host/host-service";
import { getExternalSessionImportService } from "../session-composition";

import { readUsageStatistics } from "../session-composition";

import { createUsageStatisticsRpcRoutes } from "../routes/usage-statistics-rpc-routes";
import { ModelService } from "@workbench/pi-sdk-models";
import { getPiPackageCatalogService } from "@workbench/pi-sdk-resources/catalog";
import { InstalledPackageService } from "../resource-composition";

import { PromptService } from "../resource-composition";

import { getPiResourceMutationCoordinator } from "../resource-composition";

import { getScopedResourceContextService } from "../resource-composition";

import { createPiSessionContextTraceService } from "../session-composition";

import { createPiSessionProtocolFacade } from "../session-composition";

import { notifyModelProviderConfigurationChanged } from "../session-composition/registry";

import { AgentSettingsService } from "../resource-composition";

import { SkillService } from "../resource-composition";

import { getProjectTrustService } from "@workbench/pi-sdk-resources/trust";
import { createWorkspaceProtocolService } from "../resource-composition";

import {
  createAgentSettingsRpcRoutes,
  type AgentSettingsRpcRoutesDependencies,
} from "../routes/agent-settings-rpc-routes";
import {
  createExtensionRpcRoutes,
  type ExtensionRpcRoutesDependencies,
} from "../routes/extension-rpc-routes";
import {
  createExternalSessionImportRpcRoutes,
  type ExternalSessionImportRpcRoutesDependencies,
} from "../routes/external-session-import-rpc-routes";
import { createHostRpcRoutes, type HostRpcRoutesDependencies } from "../routes/host-rpc-routes";
import {
  createInstalledPackageRpcRoutes,
  type InstalledPackageRpcRoutesDependencies,
} from "../routes/installed-package-rpc-routes";
import {
  createModelContextWindowRpcRoutes,
  type ModelContextWindowRpcRoutesDependencies,
} from "../routes/model-context-window-rpc-routes";
import {
  createModelProviderRpcRoutes,
  type ModelProviderRpcRoutesDependencies,
} from "../routes/model-provider-rpc-routes";
import {
  createPackageCatalogRpcRoutes,
  type PackageCatalogRpcRoutesDependencies,
} from "../routes/package-catalog-rpc-routes";
import {
  createProjectTrustRpcRoutes,
  type ProjectTrustRpcRoutesDependencies,
} from "../routes/project-trust-rpc-routes";
import {
  createResourceCatalogRpcRoutes,
  type ResourceCatalogRpcRoutesDependencies,
} from "../routes/resource-catalog-rpc-routes";
import type { RpcRouteGroup } from "@workbench/api/server";
import {
  createSessionContextTraceRpcRoutes,
  type SessionContextTraceRpcRoutesDependencies,
} from "../routes/session-context-trace-rpc-routes";
import {
  createSessionRpcRoutes,
  type SessionRpcRoutesDependencies,
} from "../routes/session-rpc-routes";
import { createSkillRpcRoutes, type SkillRpcRoutesDependencies } from "../routes/skill-rpc-routes";
import {
  createWorkspaceRpcRoutes,
  type WorkspaceRpcRoutesDependencies,
} from "../routes/workspace-rpc-routes";
import { projectRpcDomainError } from "@workbench/api/server";

/** Injectable dependencies for the ordered Pi RPC route-group composition. */
export interface PiRpcRouteGroupsDependencies {
  readonly composerAttachments: ComposerAttachmentService;
  readonly usageStatistics: Parameters<typeof createUsageStatisticsRpcRoutes>[0];
  readonly session: SessionRpcRoutesDependencies;
  readonly sessionContextTrace: SessionContextTraceRpcRoutesDependencies;
  readonly externalSessionImport: ExternalSessionImportRpcRoutesDependencies;
  readonly workspace: WorkspaceRpcRoutesDependencies;
  readonly skill: SkillRpcRoutesDependencies;
  readonly extension: ExtensionRpcRoutesDependencies;
  readonly installedPackage: InstalledPackageRpcRoutesDependencies;
  readonly packageCatalog: PackageCatalogRpcRoutesDependencies;
  readonly modelProvider: ModelProviderRpcRoutesDependencies;
  readonly modelContextWindow: ModelContextWindowRpcRoutesDependencies;
  readonly agentSettings: AgentSettingsRpcRoutesDependencies;
  readonly host: HostRpcRoutesDependencies;
  readonly projectTrust: ProjectTrustRpcRoutesDependencies;
  readonly resourceCatalog: ResourceCatalogRpcRoutesDependencies;
}

/** Creates the ordered first-claim route groups from explicitly supplied domain dependencies. */
export function createPiRpcRouteGroups(
  dependencies: PiRpcRouteGroupsDependencies,
): readonly RpcRouteGroup[] {
  return [
    createComposerAttachmentRpcRoutes(dependencies.composerAttachments),
    createUsageStatisticsRpcRoutes(dependencies.usageStatistics),
    createSessionRpcRoutes(dependencies.session),
    createSessionContextTraceRpcRoutes(dependencies.sessionContextTrace),
    createExternalSessionImportRpcRoutes(dependencies.externalSessionImport),
    createWorkspaceRpcRoutes(dependencies.workspace),
    createSkillRpcRoutes(dependencies.skill),
    createExtensionRpcRoutes(dependencies.extension),
    createInstalledPackageRpcRoutes(dependencies.installedPackage),
    createPackageCatalogRpcRoutes(dependencies.packageCatalog),
    createModelProviderRpcRoutes(dependencies.modelProvider),
    createModelContextWindowRpcRoutes(dependencies.modelContextWindow),
    createAgentSettingsRpcRoutes(dependencies.agentSettings),
    createHostRpcRoutes(dependencies.host),
    createProjectTrustRpcRoutes(dependencies.projectTrust),
    createResourceCatalogRpcRoutes(dependencies.resourceCatalog),
  ];
}

export interface DefaultPiRpcRouteGroupsDependencies {
  readonly agent: WorkbenchAgentServerAdapter;
  readonly commands: AgentCommandCatalogPort & CommandCatalogProtocol;
  readonly applicationVersion: string;
  readonly openDocument: (path: string, signal: AbortSignal) => Promise<{ opened: true }>;
}

/** Creates the Pi-owned default domain graph around explicitly installed application services. */
export function createDefaultPiRpcRouteGroups({
  agent,
  commands,
  applicationVersion,
  openDocument,
}: DefaultPiRpcRouteGroupsDependencies): readonly RpcRouteGroup[] {
  const resourceMutationCoordinator = getPiResourceMutationCoordinator();
  const sessionProtocolFacade = createPiSessionProtocolFacade({ agent });
  const sessionContextTraceService = createPiSessionContextTraceService();
  const externalSessionImportService = getExternalSessionImportService();
  const workspaceProtocolService = createWorkspaceProtocolService();
  const promptService = new PromptService();
  const modelService = new ModelService({
    resolveProjectTrust: async (cwd) => getProjectTrustService().isTrusted(cwd),
    getRequestObserver: getSessionContextTrace,
  });
  const extensionService = new ExtensionService({
    mutationCoordinator: resourceMutationCoordinator,
  });
  const skillService = new SkillService({ mutationCoordinator: resourceMutationCoordinator });
  const installedPackageService = new InstalledPackageService({
    mutationCoordinator: resourceMutationCoordinator,
  });
  const packageCatalogService = getPiPackageCatalogService();
  const agentSettingsService = new AgentSettingsService();
  const hostService = new HostService(applicationVersion);
  const domainErrors = { projectDomainError: projectRpcDomainError } as const;

  return createPiRpcRouteGroups({
    composerAttachments: getComposerTextAttachmentStore(),
    usageStatistics: { readUsage: readUsageStatistics },
    session: { protocol: sessionProtocolFacade, ...domainErrors },
    sessionContextTrace: { service: sessionContextTraceService, ...domainErrors },
    externalSessionImport: { service: externalSessionImportService },
    workspace: { service: workspaceProtocolService, ...domainErrors },
    skill: { service: skillService, ...domainErrors },
    extension: { service: extensionService, ...domainErrors },
    installedPackage: { service: installedPackageService, ...domainErrors },
    packageCatalog: { service: packageCatalogService, ...domainErrors },
    modelProvider: {
      service: modelService,
      notifyProviderConfigurationChanged: notifyModelProviderConfigurationChanged,
      ...domainErrors,
    },
    modelContextWindow: {
      service: modelService,
      notifyProviderConfigurationChanged: notifyModelProviderConfigurationChanged,
      ...domainErrors,
    },
    agentSettings: {
      service: agentSettingsService,
      openDocument,
      ...domainErrors,
    },
    host: { service: hostService, ...domainErrors },
    projectTrust: {
      getService: getProjectTrustService,
      afterUpdate: () => getScopedResourceContextService().invalidate(),
      ...domainErrors,
    },
    resourceCatalog: {
      commands,
      prompts: promptService,
      ...domainErrors,
    },
  });
}
