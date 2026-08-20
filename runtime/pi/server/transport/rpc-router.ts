import {
  canOpenHostPath,
  createHostDirectory,
  HostDirectoryError,
  listHostDirectory,
  openHostPath,
  pickHostDirectory,
} from "../host/host-directories";
import { ModelService, ModelServiceError } from "../models/model-service";
import { handleInteractiveResponsePost } from "../sessions/interactive-response-registry";
import {
  getAttachedSessionCount,
  listModels,
  listSessions,
  notifyModelProviderConfigurationChanged,
} from "../sessions/session-registry";
import { SkillService, SkillServiceError } from "../skills/skill-service";
import {
  handleRpcPost,
  rpcArray,
  rpcBusinessError,
  rpcEnum,
  rpcInteger,
  rpcLiteral,
  rpcObject,
  rpcOptional,
  rpcRecord,
  rpcRefine,
  rpcString,
  rpcUnion,
  rpcUnknown,
  type RpcValidator,
} from "./rpc-transport";
import { SessionRpcService, SessionRpcServiceError } from "../sessions/session-rpc-service";
import { getWorkspaceStore } from "../workspaces/workspace-registry";
import { WorkspaceStoreError } from "../workspaces/workspace-store";

const emptyPayload = rpcObject({});
const nonEmptyString = rpcString({ minLength: 1 });
const WORKBENCH_VERSION = process.env.npm_package_version ?? "0.1.0";
const optionalPathPayload = rpcObject({ path: rpcOptional(rpcString()) });
const createDirectoryPayload = rpcObject({
  path: rpcString(),
  name: rpcString(),
});
const pathPayload = rpcObject({ path: nonEmptyString });
const createWorkspacePayload = rpcObject({ path: rpcString() });
const renameWorkspacePayload = rpcObject({
  workspaceId: nonEmptyString,
  title: rpcString({ minLength: 1, trim: true }),
});
const workspaceIdPayload = rpcObject({ workspaceId: nonEmptyString });
const insertWorkspacePayload = rpcObject({
  workspaceId: nonEmptyString,
  beforeWorkspaceId: rpcOptional(nonEmptyString),
});
const insertSessionPayload = rpcObject({
  workspaceId: nonEmptyString,
  sessionId: nonEmptyString,
  beforeSessionId: rpcOptional(nonEmptyString),
});
const sessionIdPayload = rpcObject({ sessionId: nonEmptyString });
const discoverModelsPayload = rpcObject({
  settingsNs: nonEmptyString,
  provider: rpcOptional(nonEmptyString),
  baseURL: rpcOptional(nonEmptyString),
  api: rpcOptional(nonEmptyString),
  apiKey: rpcOptional(nonEmptyString),
});
const providerModelConfiguration = rpcObject({
  id: nonEmptyString,
  name: rpcOptional(rpcString()),
  contextWindow: rpcOptional(rpcInteger({ minimum: 1 })),
  maxTokens: rpcOptional(rpcInteger({ minimum: 1 })),
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
const modelService = new ModelService();
const skillService = new SkillService();

function sessionService(): SessionRpcService {
  return new SessionRpcService({ workspaceStore: getWorkspaceStore() });
}

const sessionListPayload = rpcObject({ cursor: rpcOptional(rpcString()) });
const sessionSearchPayload = rpcObject({ query: rpcString() });
const sessionCreatePayload = rpcObject({
  workspaceId: rpcOptional(nonEmptyString),
  cwd: rpcOptional(rpcString()),
  sessionId: rpcOptional(nonEmptyString),
  agentPreset: rpcOptional(nonEmptyString),
});
const sessionHistoryPayload = rpcObject({
  sessionId: nonEmptyString,
  beforeSeq: rpcOptional(rpcInteger({ minimum: 0 })),
  maxMessages: rpcOptional(rpcInteger({ minimum: 1 })),
});
const sessionModelPayload = rpcObject({ sessionId: nonEmptyString });
const sessionSelectModelPayload = rpcObject({
  sessionId: nonEmptyString,
  provider: nonEmptyString,
  model: nonEmptyString,
  reasoningEffort: rpcOptional(nonEmptyString),
});
const sessionRenamePayload = rpcObject({ sessionId: nonEmptyString, title: rpcString() });
const sessionForkPayload = rpcObject({
  sessionId: nonEmptyString,
  atSeq: rpcOptional(rpcInteger({ minimum: 0 })),
});
const promptTextContent = rpcObject({ type: rpcLiteral("text"), text: rpcString() });
const promptImageContent = rpcObject({
  type: rpcLiteral("image"),
  mediaType: rpcEnum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  data: rpcString(),
  name: rpcOptional(rpcString()),
});
const sessionPromptPayload = rpcObject({
  sessionId: nonEmptyString,
  mode: rpcEnum(["queue", "steer"]),
  content: rpcArray(rpcUnion([promptTextContent, promptImageContent])),
  clientTimeZone: rpcOptional(rpcString()),
});
const sessionAttachmentPayload = rpcObject({
  sessionId: nonEmptyString,
  attachmentId: nonEmptyString,
});
const contentBlock = rpcRefine(rpcRecord(rpcUnknown), (value) => typeof value.type === "string", {
  message: "Content blocks must contain a string type.",
  path: ["type"],
}) as RpcValidator<{ type: string; [key: string]: unknown }>;
const queueAction = rpcUnion([
  rpcObject({ kind: rpcLiteral("edit"), content: rpcArray(contentBlock) }),
  rpcObject({ kind: rpcLiteral("remove") }),
  rpcObject({ kind: rpcLiteral("steer") }),
]);
const sessionUpdateQueuePayload = rpcObject({
  sessionId: nonEmptyString,
  itemId: nonEmptyString,
  action: queueAction,
});

function throwDomainError(error: unknown): never {
  if (
    error instanceof WorkspaceStoreError ||
    error instanceof HostDirectoryError ||
    error instanceof ModelServiceError ||
    error instanceof SessionRpcServiceError ||
    error instanceof SkillServiceError
  ) {
    throw rpcBusinessError(error.code, error.message, { ...error.details }, { cause: error });
  }
  throw error;
}

function isAborted(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

async function workspaceList() {
  const { sessions } = await listSessions();
  return getWorkspaceStore().reconcileSessions(
    sessions.map((session) => ({ id: session.id, cwd: session.cwd })),
  );
}

async function archiveWorkspaceSession(sessionId: string) {
  const { sessions } = await listSessions();
  if (!sessions.some((session) => session.id === sessionId)) {
    throw rpcBusinessError("session-not-found", "The session does not exist.", { sessionId });
  }
  return getWorkspaceStore().archiveSession({ sessionId });
}

async function hostDescription() {
  const models = await listModels(process.cwd()).catch(() => undefined);
  return {
    version: WORKBENCH_VERSION,
    cwd: process.cwd(),
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
  switch (method) {
    case "respond":
      return handleInteractiveResponsePost(request);
    case "session.list":
      return handleRpcPost(request, {
        method,
        payload: sessionListPayload,
        handler: (payload) => sessionService().list(payload),
      });
    case "session.search":
      return handleRpcPost(request, {
        method,
        payload: sessionSearchPayload,
        handler: async (payload) => {
          try {
            return await sessionService().search(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "session.create":
      return handleRpcPost(request, {
        method,
        payload: sessionCreatePayload,
        handler: async (payload) => {
          try {
            return await sessionService().create(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "session.history":
      return handleRpcPost(request, {
        method,
        payload: sessionHistoryPayload,
        handler: async (payload) => {
          try {
            return await sessionService().history(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "session.models":
      return handleRpcPost(request, {
        method,
        payload: sessionModelPayload,
        handler: async (payload) => {
          try {
            return await sessionService().models(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "session.selectModel":
      return handleRpcPost(request, {
        method,
        payload: sessionSelectModelPayload,
        handler: async (payload) => {
          try {
            return await sessionService().selectModel(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "session.rename":
      return handleRpcPost(request, {
        method,
        payload: sessionRenamePayload,
        handler: async (payload) => {
          try {
            return await sessionService().rename(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "session.fork":
      return handleRpcPost(request, {
        method,
        payload: sessionForkPayload,
        handler: async (payload) => {
          try {
            return await sessionService().fork(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "session.prompt":
      return handleRpcPost(request, {
        method,
        payload: sessionPromptPayload,
        handler: async (payload, context) => {
          try {
            return await sessionService().prompt(payload, { rpcId: context.rpcId });
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "session.attachment":
      return handleRpcPost(request, {
        method,
        payload: sessionAttachmentPayload,
        handler: async (payload) => {
          try {
            return await sessionService().attachment(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "session.updateQueue":
      return handleRpcPost(request, {
        method,
        payload: sessionUpdateQueuePayload,
        handler: async (payload) => {
          try {
            return await sessionService().updateQueue(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "session.cancel":
      return handleRpcPost(request, {
        method,
        payload: sessionIdPayload,
        handler: async (payload) => {
          try {
            return await sessionService().cancel(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
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
    case "workspace.list":
      return handleRpcPost(request, {
        method,
        payload: emptyPayload,
        handler: workspaceList,
      });
    case "workspace.create":
      return handleRpcPost(request, {
        method,
        payload: createWorkspacePayload,
        handler: async ({ path }) => {
          try {
            return await getWorkspaceStore().create({ path });
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "workspace.rename":
      return handleRpcPost(request, {
        method,
        payload: renameWorkspacePayload,
        handler: async (payload) => {
          try {
            return await getWorkspaceStore().rename(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "workspace.delete":
      return handleRpcPost(request, {
        method,
        payload: workspaceIdPayload,
        handler: async (payload) => {
          try {
            return await getWorkspaceStore().delete(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "workspace.insertBefore":
      return handleRpcPost(request, {
        method,
        payload: insertWorkspacePayload,
        handler: async (payload) => {
          try {
            return await getWorkspaceStore().insertBefore(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "workspace.insertSessionBefore":
      return handleRpcPost(request, {
        method,
        payload: insertSessionPayload,
        handler: async (payload) => {
          try {
            return await getWorkspaceStore().insertSessionBefore(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "workspace.archiveSession":
      return handleRpcPost(request, {
        method,
        payload: sessionIdPayload,
        handler: ({ sessionId }) => archiveWorkspaceSession(sessionId),
      });
    case "skill.list":
      return handleRpcPost(request, {
        method,
        payload: sessionIdPayload,
        handler: async (payload) => {
          try {
            return await skillService.list(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "llm.providers":
      return handleRpcPost(request, {
        method,
        payload: emptyPayload,
        handler: () => modelService.providers(),
      });
    case "llm.providerConfig":
      return handleRpcPost(request, {
        method,
        payload: modelProviderPayload,
        handler: (payload) => modelService.providerConfig(payload),
      });
    case "llm.configureProvider":
      return handleRpcPost(request, {
        method,
        payload: configureModelProviderPayload,
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
    default:
      return new Response("Not Found", { status: 404 });
  }
}
