import { VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";

import { INLINE_DOCUMENT_MEDIA_TYPES, INLINE_IMAGE_MEDIA_TYPES } from "../../attachment-contracts";
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
import { ModelService, ModelServiceError } from "../models/model-service";
import {
  AgentSettingsService,
  AgentSettingsServiceError,
} from "../settings/agent-settings-service";
import { ImageUnderstandingSettingsStoreError } from "../image-understanding/settings-store";
import { getImageUnderstandingSettingsStore } from "../image-understanding/registry";
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
  rpcBoolean,
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
import type { WorkbenchComposerJsonValue } from "../../../composer-request";
import { SessionRpcService, SessionRpcServiceError } from "../sessions/session-rpc-service";
import { getWorkspaceStore } from "../workspaces/workspace-registry";
import { WorkspaceFileError, WorkspaceFileService } from "../workspaces/workspace-files";
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
const localAppOpenPayload = rpcObject({
  appId: rpcString({ minLength: 1, maxLength: 256 }),
  target: rpcString({ minLength: 1, maxLength: 32_768 }),
});
const workspaceFilesListPayload = rpcObject({
  workspaceId: nonEmptyString,
  relativePath: rpcOptional(rpcString({ maxLength: 16_384 })),
});
const workspaceFileReadPayload = rpcObject({
  workspaceId: nonEmptyString,
  relativePath: rpcString({ minLength: 1, maxLength: 16_384 }),
});
const workspaceFileWritePayload = rpcObject({
  workspaceId: nonEmptyString,
  relativePath: rpcString({ minLength: 1, maxLength: 16_384 }),
  content: rpcString({ maxLength: 5 * 1024 * 1024 }),
  expectedVersion: nonEmptyString,
});
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
const setWorkspacePinnedPayload = rpcObject({
  workspaceId: nonEmptyString,
  pinned: rpcBoolean,
});
const sessionIdPayload = rpcObject({ sessionId: nonEmptyString });
const setSessionPinnedPayload = rpcObject({
  sessionId: nonEmptyString,
  pinned: rpcBoolean,
});
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
  input: rpcOptional(rpcArray(rpcEnum(["text", "image"]))),
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
const agentCompactionPatch = rpcObject({
  enabled: rpcOptional(rpcBoolean),
  reserveTokens: rpcOptional(rpcInteger({ minimum: 1, maximum: 10_000_000 })),
  keepRecentTokens: rpcOptional(rpcInteger({ minimum: 1, maximum: 10_000_000 })),
});
const agentSettingsPatch = rpcObject({
  systemPrompt: rpcOptional(rpcString({ maxLength: 500_000 })),
  compaction: rpcOptional(agentCompactionPatch),
});
const settingsUpdatePayload = rpcObject({
  ns: nonEmptyString,
  patch: agentSettingsPatch,
  expectedRevision: rpcOptional(rpcInteger({ minimum: 0 })),
});
const imageUnderstandingCredential = rpcOptional(
  rpcUnion([rpcString({ maxLength: 16_384 }), rpcLiteral(null)]),
);
const imageUnderstandingUpdatePayload = rpcObject({
  expectedRevision: rpcOptional(rpcInteger({ minimum: 0 })),
  patch: rpcObject({
    routing: rpcOptional(rpcEnum(["auto", "always-preprocess", "native-only", "disabled"])),
    engine: rpcOptional(rpcEnum(["ocr", "multimodal"])),
    ocrProvider: rpcOptional(rpcEnum(["glm-ocr", "paddleocr"])),
    glm: rpcOptional(
      rpcObject({
        endpoint: rpcOptional(rpcString({ maxLength: 2_048 })),
        model: rpcOptional(rpcString({ maxLength: 256 })),
        apiKey: imageUnderstandingCredential,
      }),
    ),
    paddle: rpcOptional(
      rpcObject({
        endpoint: rpcOptional(rpcString({ maxLength: 2_048 })),
        model: rpcOptional(rpcString({ maxLength: 256 })),
        apiKey: imageUnderstandingCredential,
        pollIntervalMs: rpcOptional(rpcInteger({ minimum: 100, maximum: 60_000 })),
        pollTimeoutMs: rpcOptional(rpcInteger({ minimum: 1_000, maximum: 3_600_000 })),
      }),
    ),
    ocrAdapter: rpcOptional(
      rpcObject({
        preset: rpcOptional(
          rpcEnum(["glm-ocr", "paddleocr-vl-1.6", "pp-ocrv6", "pp-structure-v3", "custom"]),
        ),
        source: rpcOptional(rpcString({ maxLength: 100_000 })),
        endpoint: rpcOptional(rpcString({ maxLength: 2_048 })),
        model: rpcOptional(rpcString({ maxLength: 256 })),
        apiKey: imageUnderstandingCredential,
        pollIntervalMs: rpcOptional(rpcInteger({ minimum: 100, maximum: 60_000 })),
        pollTimeoutMs: rpcOptional(rpcInteger({ minimum: 1_000, maximum: 3_600_000 })),
      }),
    ),
    multimodal: rpcOptional(
      rpcObject({
        provider: rpcOptional(rpcString({ maxLength: 256 })),
        model: rpcOptional(rpcString({ maxLength: 256 })),
      }),
    ),
  }),
});
const commandService = new CommandService();
const modelService = new ModelService();
const extensionService = new ExtensionService();
const skillService = new SkillService();
const agentSettingsService = new AgentSettingsService();
const workspaceFileService = new WorkspaceFileService({ workspaceStore: getWorkspaceStore });

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
const sessionRegeneratePayload = rpcObject({
  sessionId: nonEmptyString,
  messageId: nonEmptyString,
});
const sessionSelectBranchPayload = rpcObject({
  sessionId: nonEmptyString,
  leafId: nonEmptyString,
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
  mediaType: rpcEnum(INLINE_IMAGE_MEDIA_TYPES),
  data: rpcString(),
  name: rpcOptional(rpcString()),
});
const promptDocumentContent = rpcObject({
  type: rpcLiteral("file"),
  mediaType: rpcEnum(INLINE_DOCUMENT_MEDIA_TYPES),
  data: rpcString(),
  name: rpcOptional(rpcString()),
});
function isComposerJsonValue(value: unknown, depth = 0): value is WorkbenchComposerJsonValue {
  if (depth > 32) return false;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every((item) => isComposerJsonValue(item, depth + 1));
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((item) => isComposerJsonValue(item, depth + 1))
  );
}
const composerJsonValue = rpcRefine(rpcUnknown, isComposerJsonValue, {
  message: "Composer values must be finite JSON values with at most 32 levels.",
}) as RpcValidator<WorkbenchComposerJsonValue>;
const composerCommand = rpcObject({
  id: rpcString({ minLength: 1, maxLength: 4096 }),
  commandId: rpcString({ minLength: 1, maxLength: 2048 }),
  label: rpcString({ maxLength: 4096 }),
  scope: rpcEnum(["message", "segment"]),
  source: rpcEnum(["workbench", "pi"]),
  args: rpcOptional(composerJsonValue),
});
const composerDocumentNode = rpcUnion([
  rpcObject({
    type: rpcLiteral("text"),
    text: rpcString({ maxLength: 200_000 }),
  }),
  rpcObject({
    type: rpcLiteral("command"),
    id: rpcString({ minLength: 1, maxLength: 4096 }),
    commandId: rpcString({ minLength: 1, maxLength: 2048 }),
    label: rpcString({ maxLength: 4096 }),
    scope: rpcEnum(["message", "segment"]),
    source: rpcEnum(["workbench", "pi"]),
    args: rpcOptional(composerJsonValue),
    inactive: rpcOptional(rpcLiteral(true)),
  }),
  rpcObject({
    type: rpcLiteral("command-argument"),
    id: rpcString({ minLength: 1, maxLength: 4096 }),
    commandNodeId: rpcString({ minLength: 1, maxLength: 4096 }),
    field: rpcString({ minLength: 1, maxLength: 2048 }),
    text: rpcString({ maxLength: 200_000 }),
  }),
  rpcObject({
    type: rpcLiteral("mention"),
    id: rpcString({ minLength: 1, maxLength: 4096 }),
    mentionType: rpcString({ minLength: 1, maxLength: 2048 }),
    value: rpcString({ maxLength: 200_000 }),
    label: rpcString({ maxLength: 4096 }),
  }),
  rpcObject({
    type: rpcLiteral("attachment"),
    id: rpcString({ minLength: 1, maxLength: 4096 }),
    attachmentType: rpcString({ minLength: 1, maxLength: 2048 }),
    value: rpcString({ maxLength: 200_000 }),
    label: rpcString({ maxLength: 4096 }),
  }),
]);
const composerContext = rpcObject({
  type: rpcString({ minLength: 1, maxLength: 2048 }),
  value: composerJsonValue,
});
const composerSubmission = rpcObject({
  version: rpcLiteral(1),
  document: rpcOptional(rpcArray(composerDocumentNode, { maxLength: 512 })),
  sourceText: rpcString({ maxLength: 200_000 }),
  text: rpcString({ maxLength: 200_000 }),
  mode: rpcOptional(rpcString({ maxLength: 2048 })),
  model: rpcOptional(rpcString({ maxLength: 2048 })),
  context: rpcArray(composerContext, { maxLength: 64 }),
  metadata: rpcRecord(composerJsonValue),
  commands: rpcArray(composerCommand, { maxLength: 64 }),
});
const sessionPromptPayload = rpcObject({
  sessionId: nonEmptyString,
  mode: rpcEnum(["queue", "steer"]),
  content: rpcArray(rpcUnion([promptTextContent, promptImageContent, promptDocumentContent])),
  clientTimeZone: rpcOptional(rpcString()),
  composer: rpcOptional(composerSubmission),
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
    error instanceof ExtensionServiceError ||
    error instanceof SkillServiceError ||
    error instanceof AgentSettingsServiceError
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
  const { items, pinnedWorkspaceIds, pinnedSessionIds } =
    await getWorkspaceStore().reconcileSessions(
      sessions.map((session) => ({ id: session.id, cwd: session.cwd })),
    );
  return { items, pinnedWorkspaceIds, pinnedSessionIds };
}

async function workspaceArchivedSessionsList() {
  const { archivedSessionIds } = await getWorkspaceStore().list();
  return { sessionIds: archivedSessionIds };
}

async function archiveWorkspaceSession(sessionId: string) {
  const { sessions } = await listSessions();
  if (!sessions.some((session) => session.id === sessionId)) {
    throw rpcBusinessError("session-not-found", "The session does not exist.", { sessionId });
  }
  return getWorkspaceStore().archiveSession({ sessionId });
}

async function unarchiveWorkspaceSession(sessionId: string) {
  const { sessions } = await listSessions();
  const session = sessions.find((candidate) => candidate.id === sessionId);
  if (!session) {
    throw rpcBusinessError("session-not-found", "The session does not exist.", { sessionId });
  }
  return getWorkspaceStore().unarchiveSession({ id: session.id, cwd: session.cwd });
}

async function setWorkspaceSessionPinned(sessionId: string, pinned: boolean) {
  const { sessions } = await listSessions();
  if (!sessions.some((session) => session.id === sessionId)) {
    throw rpcBusinessError("session-not-found", "The session does not exist.", { sessionId });
  }
  return getWorkspaceStore().setSessionPinned({ sessionId, pinned });
}

async function hostDescription() {
  const models = await listModels(process.cwd()).catch(() => undefined);
  return {
    product: "pi-workbench" as const,
    version: WORKBENCH_VERSION,
    piVersion: PI_VERSION,
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
    case "session.regenerate":
      return handleRpcPost(request, {
        method,
        payload: sessionRegeneratePayload,
        handler: async (payload) => {
          try {
            return await sessionService().regenerate(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "session.selectBranch":
      return handleRpcPost(request, {
        method,
        payload: sessionSelectBranchPayload,
        handler: async (payload) => {
          try {
            return await sessionService().selectBranch(payload);
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
    case "session.delete":
      return handleRpcPost(request, {
        method,
        payload: sessionIdPayload,
        handler: async (payload) => {
          try {
            return await sessionService().delete(payload);
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
    case "workspace.files.list":
      return handleRpcPost(request, {
        method,
        payload: workspaceFilesListPayload,
        handler: async (payload, context) => {
          try {
            return await workspaceFileService.listDirectory(payload, context.signal);
          } catch (error) {
            if (isAborted(error, context.signal)) {
              throw rpcBusinessError("cancelled", "Directory listing was cancelled.", {});
            }
            throwDomainError(error);
          }
        },
      });
    case "workspace.files.describe":
      return handleRpcPost(request, {
        method,
        payload: workspaceFileReadPayload,
        handler: async (payload, context) => {
          try {
            return await workspaceFileService.describeFile(payload, context.signal);
          } catch (error) {
            if (isAborted(error, context.signal)) {
              throw rpcBusinessError("cancelled", "File inspection was cancelled.", {});
            }
            throwDomainError(error);
          }
        },
      });
    case "workspace.files.read":
      return handleRpcPost(request, {
        method,
        payload: workspaceFileReadPayload,
        handler: async (payload, context) => {
          try {
            return await workspaceFileService.readFile(payload, context.signal);
          } catch (error) {
            if (isAborted(error, context.signal)) {
              throw rpcBusinessError("cancelled", "File reading was cancelled.", {});
            }
            throwDomainError(error);
          }
        },
      });
    case "workspace.files.write":
      return handleRpcPost(request, {
        method,
        payload: workspaceFileWritePayload,
        maxRequestBodyBytes: 20 * 1024 * 1024,
        handler: async (payload, context) => {
          try {
            return await workspaceFileService.writeFile(payload, context.signal);
          } catch (error) {
            if (isAborted(error, context.signal)) {
              throw rpcBusinessError("cancelled", "File writing was cancelled.", {});
            }
            throwDomainError(error);
          }
        },
      });
    case "workspace.list":
      return handleRpcPost(request, {
        method,
        payload: emptyPayload,
        handler: workspaceList,
      });
    case "workspace.listArchivedSessions":
      return handleRpcPost(request, {
        method,
        payload: emptyPayload,
        handler: workspaceArchivedSessionsList,
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
    case "workspace.setPinned":
      return handleRpcPost(request, {
        method,
        payload: setWorkspacePinnedPayload,
        handler: async (payload) => {
          try {
            return await getWorkspaceStore().setPinned(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "workspace.setSessionPinned":
      return handleRpcPost(request, {
        method,
        payload: setSessionPinnedPayload,
        handler: ({ sessionId, pinned }) => setWorkspaceSessionPinned(sessionId, pinned),
      });
    case "workspace.archiveSession":
      return handleRpcPost(request, {
        method,
        payload: sessionIdPayload,
        handler: ({ sessionId }) => archiveWorkspaceSession(sessionId),
      });
    case "workspace.unarchiveSession":
      return handleRpcPost(request, {
        method,
        payload: sessionIdPayload,
        handler: ({ sessionId }) => unarchiveWorkspaceSession(sessionId),
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
    case "command.list":
      return handleRpcPost(request, {
        method,
        payload: sessionIdPayload,
        handler: async (payload) => {
          try {
            return await commandService.list(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "extension.list":
      return handleRpcPost(request, {
        method,
        payload: sessionIdPayload,
        handler: async (payload) => {
          try {
            return await extensionService.list(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "settings.describe":
      return handleRpcPost(request, {
        method,
        payload: emptyPayload,
        loopbackOnly: true,
        handler: async () => {
          try {
            return await agentSettingsService.describe();
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "settings.openDocument":
      return handleRpcPost(request, {
        method,
        payload: emptyPayload,
        loopbackOnly: true,
        handler: async (_payload, context) => {
          try {
            const settingsFile = await agentSettingsService.prepareDocument();
            return await openHostPath(settingsFile, { signal: context.signal });
          } catch (error) {
            if (isAborted(error, context.signal)) {
              throw rpcBusinessError("cancelled", "Opening settings was cancelled.", {});
            }
            if (error instanceof AgentSettingsServiceError) throwDomainError(error);
            throw rpcBusinessError(
              "internal",
              "The host could not open the settings document.",
              {},
              { cause: error },
            );
          }
        },
      });
    case "settings.update":
      return handleRpcPost(request, {
        method,
        payload: settingsUpdatePayload,
        loopbackOnly: true,
        handler: async (payload) => {
          try {
            return await agentSettingsService.update(payload);
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "imageUnderstanding.describe":
      return handleRpcPost(request, {
        method,
        payload: emptyPayload,
        loopbackOnly: true,
        handler: async () => {
          try {
            return await getImageUnderstandingSettingsStore().describe();
          } catch (error) {
            throwDomainError(error);
          }
        },
      });
    case "imageUnderstanding.update":
      return handleRpcPost(request, {
        method,
        payload: imageUnderstandingUpdatePayload,
        loopbackOnly: true,
        handler: async (payload) => {
          try {
            return await getImageUnderstandingSettingsStore().update(payload);
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
