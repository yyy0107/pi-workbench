import { ensureWorkbenchBuiltinResources } from "./resource-composition/builtin-resources";
export { ensureWorkbenchBuiltinResources } from "./resource-composition/builtin-resources";
export { AgentSettingsService } from "./resource-composition/settings";

import * as Skills from "@workbench/pi-sdk-resources/skills";
import * as Extensions from "@workbench/pi-sdk-resources/extensions";
import * as Commands from "@workbench/pi-sdk-resources/commands";
import * as Prompts from "@workbench/pi-sdk-resources/prompts";
import * as Packages from "@workbench/pi-sdk-resources/packages";
import * as Contexts from "@workbench/pi-sdk-resources/contexts";
import * as Mutations from "@workbench/pi-sdk-resources/mutations";
import * as Workspaces from "@workbench/pi-sdk-resources/workspaces";

import {
  getLoadedSessions,
  getOrStartSession,
  listSessions as listPiSessions,
} from "./session-composition/registry";

import { getWorkspaceStore } from "./workspaces/workspace-registry";
import { getPiAgentHostBindings } from "./agent-runtime/pi-agent-host-bindings";
import {
  createBuiltinToolDefinitions,
  workbenchToolOverrides,
} from "@workbench/pi-workbench-runtime/tools/builtin-tools";
import { workbenchInternalPiExtensions, prepareWorkbenchPiExtensions } from "./tool-composition";

/** Select concrete session/tool/stream collaborators once in the server composition owner. */
async function getWorkspace(workspaceId: string) {
  const { items } = await getWorkspaceStore().list();
  return items.find((workspace) => workspace.workspaceId === workspaceId);
}

export class SkillService extends Skills.SkillService {
  constructor(dependencies: Partial<Skills.SkillServiceDependencies> = {}) {
    super({
      getSession: getOrStartSession,
      getScopedResourceHost: async (target) => {
        const context = await getScopedResourceContextService().get(target);
        return {
          isRunning: false,
          session: {
            resourceLoader: context.resourceLoader,
            settingsManager: context.settingsManager,
            sessionManager: { getCwd: () => context.cwd },
            reload: () => context.reload(),
          },
        };
      },
      mutationCoordinator: getPiResourceMutationCoordinator(),
      ...dependencies,
    });
  }
}

export class ExtensionService extends Extensions.ExtensionService {
  constructor(dependencies: Partial<Extensions.ExtensionServiceDependencies> = {}) {
    super({
      getSession: getOrStartSession,
      getScopedResourceHost: async (target) => {
        const context = await getScopedResourceContextService().get(target);
        const bindings = getPiAgentHostBindings();
        const preferences = await bindings.readSessionPreferences?.();
        return {
          isRunning: false,
          workbenchToolSources: new Map(
            workbenchToolOverrides(context.cwd, bindings, preferences?.enhancedSearch).map(
              ({ name, source }) => [name, source],
            ),
          ),
          session: {
            resourceLoader: context.resourceLoader,
            settingsManager: context.settingsManager,
            sessionManager: { getCwd: () => context.cwd },
            reload: () => context.reload(),
          },
        };
      },
      mutationCoordinator: getPiResourceMutationCoordinator(),
      createBuiltinToolDefinitions,
      ...dependencies,
    });
  }
}

export class CommandService extends Commands.CommandService {
  constructor(dependencies: Partial<Commands.CommandServiceDependencies> = {}) {
    super({
      getSession: getOrStartSession,
      getScopedResourceHost: async (target) => {
        const context = await getScopedResourceContextService().get(target);
        return {
          session: {
            resourceLoader: context.resourceLoader,
          },
        };
      },
      ...dependencies,
    });
  }
}

export class PromptService extends Prompts.PromptService {
  constructor(dependencies: Partial<Prompts.PromptServiceDependencies> = {}) {
    super({
      scopedResources: getScopedResourceContextService(),
      mutationCoordinator: getPiResourceMutationCoordinator(),
      ...dependencies,
    });
  }
}

export class InstalledPackageService extends Packages.InstalledPackageService {
  constructor(dependencies: Partial<Packages.InstalledPackageServiceDependencies> = {}) {
    const mutationCoordinator =
      dependencies.mutationCoordinator ??
      (dependencies.getLoadedSessions
        ? new PiResourceMutationCoordinator({ getLoadedSessions: dependencies.getLoadedSessions })
        : getPiResourceMutationCoordinator());
    super({
      resolvePackageSettings: (sessionId) =>
        Packages.userPackageSettings(getOrStartSession, sessionId),
      getSession: getOrStartSession,
      getScopedResourceHost: async (target) => {
        const context = await getScopedResourceContextService().get(target);
        return { session: { settingsManager: context.settingsManager } };
      },
      getWorkspace,
      getLoadedSessions,
      describeInstalledPackage: (request) =>
        Packages.describeInstalledPackage(request, getScopedResourceContextService()),
      checkAvailablePackageUpdates: (request) =>
        Packages.checkAvailablePackageUpdates(
          request,
          getScopedResourceContextService(),
          getOrStartSession,
        ),
      reloadScopedResources: (target) => getScopedResourceContextService().reloadIfPresent(target),
      mutationCoordinator,
      ...dependencies,
    });
  }
}

export class ScopedResourceContextService extends Contexts.ScopedResourceContextService {
  constructor(dependencies: Partial<Contexts.ScopedResourceContextServiceDependencies> = {}) {
    super({
      getWorkspace,
      extensionFactories: workbenchInternalPiExtensions,
      extensionsOverride: prepareWorkbenchPiExtensions,
      ensureBuiltinResources: ensureWorkbenchBuiltinResources,
      ...dependencies,
    });
  }
}

export class PiResourceMutationCoordinator extends Mutations.PiResourceMutationCoordinator {
  constructor(dependencies: Partial<Mutations.PiResourceMutationCoordinatorDependencies> = {}) {
    super({ getLoadedSessions, ...dependencies });
  }
}

let sharedContext: ScopedResourceContextService | undefined;
export function getScopedResourceContextService() {
  return (sharedContext ??= new ScopedResourceContextService());
}
let sharedCoordinator: PiResourceMutationCoordinator | undefined;
export function getPiResourceMutationCoordinator() {
  return (sharedCoordinator ??= new PiResourceMutationCoordinator());
}
type WorkspaceProtocolServiceDependencies = Workspaces.WorkspaceProtocolServiceDependencies;
function defaultDependencies(): WorkspaceProtocolServiceDependencies {
  return {
    resolveWorkspaceStore: getWorkspaceStore,
    sessions: {
      async list() {
        const { sessions } = await listPiSessions();
        return sessions.map(({ id, cwd }) => ({ id, cwd }));
      },
    },
    resourceContexts: {
      invalidateProject(workspaceId) {
        getScopedResourceContextService().invalidate({ scope: "project", workspaceId });
      },
    },
  };
}

export function createWorkspaceProtocolService(
  overrides: Partial<WorkspaceProtocolServiceDependencies> = {},
) {
  return Workspaces.createWorkspaceProtocolService({ ...defaultDependencies(), ...overrides });
}
