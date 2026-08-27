import path from "node:path";

import { getAgentDir, VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";

import {
  canOpenHostPath,
  createHostDirectory,
  HostDirectoryError,
  listHostDirectory,
  openHostPath,
  pickHostDirectory,
} from "../host/host-directories";
import { localAppService, LocalAppServiceError } from "../local-apps/index";
import { CommandService, CommandServiceError } from "../commands/command-service";
import { ExtensionService, ExtensionServiceError } from "../extensions/extension-service";
import {
  getPiPackageCatalogService,
  PiPackageCatalogServiceError,
} from "../packages/package-catalog-service";
import {
  InstalledPackageService,
  InstalledPackageServiceError,
} from "../packages/installed-package-service";
import { getPiResourceMutationCoordinator } from "../resources/pi-resource-mutation-coordinator";
import { ModelService, ModelServiceError } from "../models/model-service";
import {
  AgentSettingsService,
  AgentSettingsServiceError,
} from "../settings/agent-settings-service";
import {
  WorkbenchSettingsService,
  WorkbenchSettingsServiceError,
} from "../settings/workbench-settings-service";
import { ImageUnderstandingSettingsStoreError } from "../attachment-understanding/settings-store";
import { getImageUnderstandingSettingsStore } from "../attachment-understanding/registry";
import { getExternalSessionImportService } from "../imports/external-session-import-service";
import { handleInteractiveResponsePost } from "../sessions/interactive-response-registry";
import {
  getAttachedSessionCount,
  listModels,
  notifyModelProviderConfigurationChanged,
} from "../sessions/session-registry";
import {
  createPiSessionContextTraceService,
  PiSessionContextTraceServiceError,
} from "../sessions/pi-session-context-trace-service";
import { SkillService, SkillServiceError } from "../skills/skill-service";
import { PromptService } from "../prompts/prompt-service";
import {
  getScopedResourceContextService,
  ScopedResourceContextError,
} from "../resources/scoped-resource-context";
import {
  handleRpcPost,
  RPC_REQUEST_BODY_LIMITS,
  rpcArray,
  rpcBoolean,
  rpcBusinessError,
  rpcEnum,
  rpcInteger,
  rpcLiteral,
  rpcNullable,
  rpcObject,
  rpcOptional,
  rpcString,
  type RpcValidator,
} from "./rpc-transport";
import type { PromptListPayload } from "@/runtime/pi/contracts/rpc";
import { createPiSessionProtocolFacade } from "../sessions/pi-session-protocol-facade";
import { SessionRpcServiceError } from "../sessions/session-rpc-service";
import { createAgentSettingsRpcRoutes } from "./routes/agent-settings-rpc-routes";
import { createExtensionRpcRoutes } from "./routes/extension-rpc-routes";
import { createExternalSessionImportRpcRoutes } from "./routes/external-session-import-rpc-routes";
import { createImageUnderstandingSettingsRpcRoutes } from "./routes/image-understanding-settings-rpc-routes";
import { createInstalledPackageRpcRoutes } from "./routes/installed-package-rpc-routes";
import { createPackageCatalogRpcRoutes } from "./routes/package-catalog-rpc-routes";
import { dispatchRpcRouteGroups, type RpcRouteGroup } from "./routes/rpc-route-group";
import { createSessionContextTraceRpcRoutes } from "./routes/session-context-trace-rpc-routes";
import { createSessionRpcRoutes } from "./routes/session-rpc-routes";
import { createSkillRpcRoutes } from "./routes/skill-rpc-routes";
import { createWorkbenchSettingsRpcRoutes } from "./routes/workbench-settings-rpc-routes";
import { createWorkspaceFileRpcRoutes } from "./routes/workspace-file-rpc-routes";
import { createWorkspaceRpcRoutes } from "./routes/workspace-rpc-routes";
import { resourceCatalogTarget, resourceListPayload } from "./resource-rpc-validators";
import { createWorkspaceFileService, WorkspaceFileError } from "../workspaces/workspace-files";
import {
  createWorkspaceProtocolService,
  WorkspaceProtocolServiceError,
} from "../workspaces/workspace-protocol-service";
import { WorkspaceStoreError } from "../workspaces/workspace-store";
import { getProjectTrustService, ProjectTrustServiceError } from "../trust/project-trust-service";

const emptyPayload = rpcObject({});
const nonEmptyString = rpcString({ minLength: 1 });
const WORKBENCH_VERSION = process.env.npm_package_version ?? "0.1.0";
const optionalPathPayload = rpcObject({ path: rpcOptional(rpcString()) });
const createDirectoryPayload = rpcObject({
  path: rpcString(),
  name: rpcString(),
});
const pathPayload = rpcObject({ path: nonEmptyString });
const projectTrustUpdatePayload = rpcObject({
  path: nonEmptyString,
  trusted: rpcBoolean,
});
const localAppOpenPayload = rpcObject({
  appId: rpcString({ minLength: 1, maxLength: 256 }),
  target: rpcString({ minLength: 1, maxLength: 32_768 }),
});
const promptListPayload = rpcObject({
  target: resourceCatalogTarget,
}) as RpcValidator<PromptListPayload>;
const discoverModelsPayload = rpcObject({
  settingsNs: nonEmptyString,
  provider: rpcOptional(nonEmptyString),
  baseURL: rpcOptional(nonEmptyString),
  api: rpcOptional(nonEmptyString),
  apiKey: rpcOptional(nonEmptyString),
  source: rpcOptional(rpcEnum(["catalog", "endpoint"])),
});
const testModelImageInputPayload = rpcObject({
  provider: nonEmptyString,
  model: nonEmptyString,
});
const thinkingLevelValue = rpcNullable(rpcString());
const thinkingLevelMap = rpcObject({
  off: rpcOptional(thinkingLevelValue),
  minimal: rpcOptional(thinkingLevelValue),
  low: rpcOptional(thinkingLevelValue),
  medium: rpcOptional(thinkingLevelValue),
  high: rpcOptional(thinkingLevelValue),
  xhigh: rpcOptional(thinkingLevelValue),
  max: rpcOptional(thinkingLevelValue),
});
const providerModelConfiguration = rpcObject({
  id: nonEmptyString,
  name: rpcOptional(rpcString()),
  contextWindow: rpcOptional(rpcInteger({ minimum: 1 })),
  maxTokens: rpcOptional(rpcInteger({ minimum: 1 })),
  reasoning: rpcOptional(rpcBoolean),
  thinkingLevelMap: rpcOptional(thinkingLevelMap),
  input: rpcOptional(rpcArray(rpcEnum(["text", "image"]))),
  imageInputSource: rpcOptional(rpcEnum(["provider-api", "runtime", "test", "user"])),
});
const providerConfiguration = rpcObject({
  displayName: rpcOptional(rpcString()),
  baseURL: nonEmptyString,
  api: rpcEnum([
    "anthropic-messages",
    "openai-completions",
    "openai-responses",
    "google-generative-ai",
  ]),
  models: rpcOptional(rpcArray(providerModelConfiguration)),
});
const configureModelProviderPayload = rpcObject({
  provider: nonEmptyString,
  apiKey: rpcOptional(rpcString({ minLength: 1, trim: true })),
  configuration: rpcOptional(providerConfiguration),
});
const modelProviderPayload = rpcObject({ provider: nonEmptyString });
const startModelProviderLoginPayload = rpcObject({
  provider: nonEmptyString,
  authType: rpcLiteral("oauth"),
});
const modelProviderLoginPayload = rpcObject({
  loginId: rpcString({ minLength: 1, maxLength: 256 }),
});
const respondModelProviderLoginPayload = rpcObject({
  loginId: rpcString({ minLength: 1, maxLength: 256 }),
  promptId: rpcString({ minLength: 1, maxLength: 256 }),
  value: rpcString({ maxLength: 16_384 }),
});
const modelContextWindowPayload = rpcObject({
  provider: nonEmptyString,
  model: nonEmptyString,
});
const updateModelContextWindowPayload = rpcObject({
  provider: nonEmptyString,
  model: nonEmptyString,
  contextWindow: rpcInteger({ minimum: 1, maximum: 10_000_000 }),
});
const resourceMutationCoordinator = getPiResourceMutationCoordinator();
const commandService = new CommandService();
const sessionProtocolFacade = createPiSessionProtocolFacade({ commands: commandService });
const sessionContextTraceService = createPiSessionContextTraceService();
const externalSessionImportService = getExternalSessionImportService();
const workspaceProtocolService = createWorkspaceProtocolService();
const promptService = new PromptService();
const modelService = new ModelService();
const extensionService = new ExtensionService({ mutationCoordinator: resourceMutationCoordinator });
const skillService = new SkillService({ mutationCoordinator: resourceMutationCoordinator });
const installedPackageService = new InstalledPackageService({
  mutationCoordinator: resourceMutationCoordinator,
});
const packageCatalogService = getPiPackageCatalogService();
const agentSettingsService = new AgentSettingsService();
const workspaceFileService = createWorkspaceFileService();

function workbenchSettingsService(): WorkbenchSettingsService {
  return new WorkbenchSettingsService();
}

function throwDomainError(error: unknown): never {
  if (error instanceof ImageUnderstandingSettingsStoreError) {
    throw rpcBusinessError(
      error.code,
      error.message,
      {
        ...(error.expectedRevision === undefined
          ? {}
          : { expectedRevision: error.expectedRevision }),
        ...(error.actualRevision === undefined ? {} : { actualRevision: error.actualRevision }),
      },
      { cause: error },
    );
  }
  if (
    error instanceof WorkspaceStoreError ||
    error instanceof WorkspaceFileError ||
    error instanceof HostDirectoryError ||
    error instanceof LocalAppServiceError ||
    error instanceof CommandServiceError ||
    error instanceof ModelServiceError ||
    error instanceof SessionRpcServiceError ||
    error instanceof PiSessionContextTraceServiceError ||
    error instanceof WorkspaceProtocolServiceError ||
    error instanceof ExtensionServiceError ||
    error instanceof SkillServiceError ||
    error instanceof InstalledPackageServiceError ||
    error instanceof PiPackageCatalogServiceError ||
    error instanceof AgentSettingsServiceError ||
    error instanceof WorkbenchSettingsServiceError ||
    error instanceof ProjectTrustServiceError ||
    error instanceof ScopedResourceContextError
  ) {
    throw rpcBusinessError(error.code, error.message, { ...error.details }, { cause: error });
  }
  throw error;
}

const sessionRpcRoutes = createSessionRpcRoutes({
  protocol: sessionProtocolFacade,
  projectDomainError: throwDomainError,
});
const sessionContextTraceRpcRoutes = createSessionContextTraceRpcRoutes({
  service: sessionContextTraceService,
  projectDomainError: throwDomainError,
});
const externalSessionImportRpcRoutes = createExternalSessionImportRpcRoutes({
  service: externalSessionImportService,
});
const workspaceRpcRoutes = createWorkspaceRpcRoutes({
  service: workspaceProtocolService,
  projectDomainError: throwDomainError,
});
const workspaceFileRpcRoutes = createWorkspaceFileRpcRoutes({
  service: workspaceFileService,
  projectDomainError: throwDomainError,
});
const skillRpcRoutes = createSkillRpcRoutes({
  service: skillService,
  projectDomainError: throwDomainError,
});
const extensionRpcRoutes = createExtensionRpcRoutes({
  service: extensionService,
  projectDomainError: throwDomainError,
});
const installedPackageRpcRoutes = createInstalledPackageRpcRoutes({
  service: installedPackageService,
  projectDomainError: throwDomainError,
});
const packageCatalogRpcRoutes = createPackageCatalogRpcRoutes({
  service: packageCatalogService,
  projectDomainError: throwDomainError,
});
const agentSettingsRpcRoutes = createAgentSettingsRpcRoutes({
  service: agentSettingsService,
  openDocument: (settingsFile, signal) => openHostPath(settingsFile, { signal }),
  projectDomainError: throwDomainError,
});
const workbenchSettingsRpcRoutes = createWorkbenchSettingsRpcRoutes({
  getService: workbenchSettingsService,
  projectDomainError: throwDomainError,
});
const imageUnderstandingSettingsRpcRoutes = createImageUnderstandingSettingsRpcRoutes({
  getStore: getImageUnderstandingSettingsStore,
  projectDomainError: throwDomainError,
});
const rpcRouteGroups: readonly RpcRouteGroup[] = [
  sessionRpcRoutes,
  sessionContextTraceRpcRoutes,
  externalSessionImportRpcRoutes,
  workspaceRpcRoutes,
  workspaceFileRpcRoutes,
  skillRpcRoutes,
  extensionRpcRoutes,
  installedPackageRpcRoutes,
  packageCatalogRpcRoutes,
  agentSettingsRpcRoutes,
  workbenchSettingsRpcRoutes,
  imageUnderstandingSettingsRpcRoutes,
];

function isAborted(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

async function hostDescription() {
  const models = await listModels(process.cwd()).catch(() => undefined);
  return {
    product: "pi-workbench" as const,
    version: WORKBENCH_VERSION,
    piVersion: PI_VERSION,
    cwd: process.cwd(),
    userPackageDir: path.join(getAgentDir(), "npm"),
    ...(models?.defaultModel
      ? {
          provider: models.defaultModel.provider,
          model: models.defaultModel.modelId,
        }
      : {}),
    attachedSessions: getAttachedSessionCount(),
    canOpenPath: canOpenHostPath(),
  };
}

export async function handlePiRpcPost(request: Request, method: string): Promise<Response> {
  const domainResponse = dispatchRpcRouteGroups(request, method, rpcRouteGroups);
  if (domainResponse) return domainResponse;

  switch (method) {
    case "respond":
      return handleInteractiveResponsePost(request);
    case "host.describe":
      return handleRpcPost(request, {
        method,
        payload: emptyPayload,
        handler: hostDescription,
      });
    case "host.pickDirectory":
      return handleRpcPost(request, {
        method,
        payload: emptyPayload,
        loopbackOnly: true,
        handler: async (_payload, context) => {
          try {
            return { path: await pickHostDirectory(context.signal) };
          } catch (error) {
            if (isAborted(error, context.signal)) {
              throw rpcBusinessError("cancelled", "Directory selection was cancelled.", {});
            }
            throwDomainError(error);
          }
        },
      });
    case "host.listDirectory":
      return handleRpcPost(request, {
        method,
        payload: optionalPathPayload,
        handler: async ({ path }, context) => {
          try {
            return await listHostDirectory(path, context.signal);
          } catch (error) {
            if (isAborted(error, context.signal)) {
              throw rpcBusinessError("cancelled", "Directory listing was cancelled.", {});
            }
            throwDomainError(error);
          }
        },
      });
    case "host.createDirectory":
      return handleRpcPost(request, {
        method,
        payload: createDirectoryPayload,
        handler: async (payload) => {
          try {
            return await createHostDirectory(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "host.openPath":
      return handleRpcPost(request, {
        method,
        payload: pathPayload,
        loopbackOnly: true,
        handler: async ({ path }, context) => {
          try {
            return await openHostPath(path, { signal: context.signal });
          } catch (error) {
            if (isAborted(error, context.signal)) {
              throw rpcBusinessError("cancelled", "Opening the host path was cancelled.", {});
            }
            if (error instanceof HostDirectoryError) throwDomainError(error);
            throw rpcBusinessError(
              "internal",
              "The host could not open the requested path.",
              {},
              { cause: error },
            );
          }
        },
      });
    case "projectTrust.describe":
      return handleRpcPost(request, {
        method,
        payload: pathPayload,
        handler: (payload) => getProjectTrustService().describe(payload),
      });
    case "projectTrust.update":
      return handleRpcPost(request, {
        method,
        payload: projectTrustUpdatePayload,
        handler: async (payload) => {
          const result = await getProjectTrustService().update(payload);
          getScopedResourceContextService().invalidate();
          return result;
        },
      });
    case "host.localApps.list":
      return handleRpcPost(request, {
        method,
        payload: emptyPayload,
        loopbackOnly: true,
        handler: async (_payload, context) => {
          try {
            return await localAppService.list(context.signal);
          } catch (error) {
            if (isAborted(error, context.signal)) {
              throw rpcBusinessError("cancelled", "Local application detection was cancelled.", {});
            }
            throwDomainError(error);
          }
        },
      });
    case "host.localApps.refresh":
      return handleRpcPost(request, {
        method,
        payload: emptyPayload,
        loopbackOnly: true,
        handler: async (_payload, context) => {
          try {
            return await localAppService.refresh(context.signal);
          } catch (error) {
            if (isAborted(error, context.signal)) {
              throw rpcBusinessError("cancelled", "Local application detection was cancelled.", {});
            }
            throwDomainError(error);
          }
        },
      });
    case "host.localApps.open":
      return handleRpcPost(request, {
        method,
        payload: localAppOpenPayload,
        loopbackOnly: true,
        handler: async ({ appId, target }, context) => {
          try {
            return await localAppService.open(appId, target, context.signal);
          } catch (error) {
            if (isAborted(error, context.signal)) {
              throw rpcBusinessError(
                "cancelled",
                "Opening the local application was cancelled.",
                {},
              );
            }
            throwDomainError(error);
          }
        },
      });
    case "command.list":
      return handleRpcPost(request, {
        method,
        payload: resourceListPayload,
        handler: async (payload) => {
          try {
            return await commandService.list(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "prompt.list":
      return handleRpcPost(request, {
        method,
        payload: promptListPayload,
        handler: async (payload) => {
          try {
            return await promptService.list(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "llm.providers":
      return handleRpcPost(request, {
        method,
        payload: emptyPayload,
        handler: async () => {
          const value = await modelService.providers();
          // This read also detects credentials changed by Pi TUI. Mark hosted
          // sessions for a cache-only refresh before their next model action.
          for (const provider of value.providers) {
            if (provider.active) notifyModelProviderConfigurationChanged(provider.provider);
          }
          return value;
        },
      });
    case "llm.providerConfig":
      return handleRpcPost(request, {
        method,
        payload: modelProviderPayload,
        handler: (payload) => modelService.providerConfig(payload),
      });
    case "llm.startProviderLogin":
      return handleRpcPost(request, {
        method,
        payload: startModelProviderLoginPayload,
        loopbackOnly: true,
        handler: async (payload) => {
          try {
            return await modelService.startProviderLogin(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "llm.providerLogin":
      return handleRpcPost(request, {
        method,
        payload: modelProviderLoginPayload,
        loopbackOnly: true,
        handler: (payload) => {
          try {
            const value = modelService.providerLogin(payload);
            if (value.status === "complete") {
              notifyModelProviderConfigurationChanged(value.provider);
            }
            return value;
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "llm.respondProviderLogin":
      return handleRpcPost(request, {
        method,
        payload: respondModelProviderLoginPayload,
        loopbackOnly: true,
        handler: (payload) => {
          try {
            const value = modelService.respondProviderLogin(payload);
            if (value.status === "complete") {
              notifyModelProviderConfigurationChanged(value.provider);
            }
            return value;
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "llm.cancelProviderLogin":
      return handleRpcPost(request, {
        method,
        payload: modelProviderLoginPayload,
        loopbackOnly: true,
        handler: (payload) => {
          try {
            return modelService.cancelProviderLogin(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "llm.modelContextWindow":
      return handleRpcPost(request, {
        method,
        payload: modelContextWindowPayload,
        handler: async (payload) => {
          try {
            return await modelService.modelContextWindow(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "llm.updateModelContextWindow":
      return handleRpcPost(request, {
        method,
        payload: updateModelContextWindowPayload,
        loopbackOnly: true,
        handler: async (payload, context) => {
          try {
            const value = await modelService.updateModelContextWindow(payload, {
              signal: context.signal,
            });
            notifyModelProviderConfigurationChanged(payload.provider);
            return value;
          } catch (error) {
            if (isAborted(error, context.signal)) {
              throw rpcBusinessError(
                "cancelled",
                "Model context-window update was cancelled.",
                {},
                { cause: error },
              );
            }
            throwDomainError(error);
          }
        },
      });
    case "llm.resetModelContextWindow":
      return handleRpcPost(request, {
        method,
        payload: modelContextWindowPayload,
        loopbackOnly: true,
        handler: async (payload, context) => {
          try {
            const value = await modelService.resetModelContextWindow(payload, {
              signal: context.signal,
            });
            notifyModelProviderConfigurationChanged(payload.provider);
            return value;
          } catch (error) {
            if (isAborted(error, context.signal)) {
              throw rpcBusinessError(
                "cancelled",
                "Model context-window reset was cancelled.",
                {},
                { cause: error },
              );
            }
            throwDomainError(error);
          }
        },
      });
    case "llm.configureProvider":
      return handleRpcPost(request, {
        method,
        payload: configureModelProviderPayload,
        maxRequestBodyBytes: RPC_REQUEST_BODY_LIMITS.modelProviderConfiguration,
        loopbackOnly: true,
        handler: async (payload, context) => {
          try {
            const value = await modelService.configureProvider(payload, { signal: context.signal });
            notifyModelProviderConfigurationChanged(payload.provider);
            return value;
          } catch (error) {
            if (isAborted(error, context.signal)) {
              throw rpcBusinessError(
                "cancelled",
                "Provider configuration was cancelled.",
                {},
                {
                  cause: error,
                },
              );
            }
            throwDomainError(error);
          }
        },
      });
    case "llm.removeProvider":
      return handleRpcPost(request, {
        method,
        payload: modelProviderPayload,
        loopbackOnly: true,
        handler: async (payload, context) => {
          try {
            const value = await modelService.removeProvider(payload, { signal: context.signal });
            notifyModelProviderConfigurationChanged(payload.provider);
            return value;
          } catch (error) {
            if (isAborted(error, context.signal)) {
              throw rpcBusinessError(
                "cancelled",
                "Provider removal was cancelled.",
                {},
                {
                  cause: error,
                },
              );
            }
            throwDomainError(error);
          }
        },
      });
    case "llm.models":
      return handleRpcPost(request, {
        method,
        payload: emptyPayload,
        handler: () => modelService.models(),
      });
    case "llm.discoverModels":
      return handleRpcPost(request, {
        method,
        payload: discoverModelsPayload,
        loopbackOnly: true,
        handler: async (payload, context) => {
          try {
            return await modelService.discoverModels(payload, { signal: context.signal });
          } catch (error) {
            if (context.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
              throw rpcBusinessError(
                "cancelled",
                "Model discovery was cancelled.",
                {},
                {
                  cause: error,
                },
              );
            }
            throwDomainError(error);
          }
        },
      });
    case "llm.testModelImageInput":
      return handleRpcPost(request, {
        method,
        payload: testModelImageInputPayload,
        loopbackOnly: true,
        handler: async (payload, context) => {
          try {
            return await modelService.testModelImageInput(payload, { signal: context.signal });
          } catch (error) {
            if (isAborted(error, context.signal)) {
              throw rpcBusinessError(
                "cancelled",
                "Model image-input test was cancelled.",
                {},
                { cause: error },
              );
            }
            throwDomainError(error);
          }
        },
      });
    default:
      return new Response("Not Found", { status: 404 });
  }
}
