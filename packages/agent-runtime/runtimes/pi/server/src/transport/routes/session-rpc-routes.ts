import { RPC_REQUEST_BODY_LIMITS } from "../rpc-request-budgets";
import { INLINE_IMAGE_MEDIA_TYPES } from "@workbench/agent-runtime-pi-protocol/attachments";
import {
  parseWorkbenchComposerSubmission,
  type WorkbenchComposerJsonValue,
  type WorkbenchComposerSubmission,
} from "@workbench/contracts/composer/request";

import type { PiSessionProtocolFacade } from "../../sessions/pi-session-protocol-facade";
import {
  handleRpcPost,
  rpcArray,
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
} from "@workbench/host-server/rpc";
import { compactionSettingsPatch } from "../compaction-rpc-validator";
import type { RpcRouteGroup } from "@workbench/host-server/rpc";

export interface SessionRpcRoutesDependencies {
  readonly protocol: PiSessionProtocolFacade;
  readonly projectDomainError: (error: unknown) => never;
}

export type SessionRpcRoutes = RpcRouteGroup;

const nonEmptyString = rpcString({ minLength: 1 });
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
  requestId: rpcOptional(nonEmptyString),
});
const sessionResumePayload = rpcObject({
  sessionId: nonEmptyString,
  checkpointId: nonEmptyString,
  expectedLeafId: nonEmptyString,
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
const sessionContextPolicy = rpcRefine(
  rpcObject({
    mode: rpcEnum(["inherit", "auto", "maximum", "custom"]),
    desiredContextTokens: rpcOptional(rpcInteger({ minimum: 1, maximum: 10_000_000 })),
    compaction: rpcOptional(compactionSettingsPatch),
  }),
  (policy) => policy.mode !== "custom" || policy.desiredContextTokens !== undefined,
  { message: "Custom context policy requires desiredContextTokens." },
);
const sessionContextPolicyUpdatePayload = rpcObject({
  sessionId: nonEmptyString,
  policy: sessionContextPolicy,
});
const sessionRenamePayload = rpcObject({ sessionId: nonEmptyString, title: rpcString() });
const sessionIdPayload = rpcObject({ sessionId: nonEmptyString });
const sessionForkPayload = rpcObject({
  sessionId: nonEmptyString,
  atSeq: rpcOptional(rpcInteger({ minimum: 0 })),
});
const sessionScratchCreatePayload = rpcObject({
  sourceSessionId: nonEmptyString,
  atSeq: rpcOptional(rpcInteger({ minimum: 0 })),
});
const sessionScratchPromotePayload = rpcObject({
  sessionId: nonEmptyString,
  title: rpcOptional(rpcString()),
});

const promptAttachmentContent = rpcObject({
  type: rpcLiteral("attachment"),
  attachmentId: rpcString({ minLength: 36, maxLength: 36 }),
});
const promptFileContent = rpcObject({
  type: rpcLiteral("file"),
  attachmentId: rpcString({ minLength: 36, maxLength: 36 }),
});
const promptTextContent = rpcObject({ type: rpcLiteral("text"), text: rpcString() });
const promptImageContent = rpcObject({
  type: rpcLiteral("image"),
  mediaType: rpcEnum(INLINE_IMAGE_MEDIA_TYPES),
  data: rpcString(),
  name: rpcOptional(rpcString()),
  attachmentId: rpcOptional(rpcString({ minLength: 36, maxLength: 36 })),
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
type ComposerWireSource = "workbench" | "pi" | "agent";

function composerCommand(source: RpcValidator<ComposerWireSource>) {
  return rpcObject({
    id: rpcString({ minLength: 1, maxLength: 4096 }),
    commandId: rpcString({ minLength: 1, maxLength: 2048 }),
    label: rpcString({ maxLength: 4096 }),
    scope: rpcEnum(["message", "segment"]),
    source,
    args: rpcOptional(composerJsonValue),
  });
}

function composerDocumentNode(source: RpcValidator<ComposerWireSource>) {
  return rpcUnion([
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
      source,
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
}

const composerContext = rpcObject({
  type: rpcString({ minLength: 1, maxLength: 2048 }),
  value: composerJsonValue,
});

function composerSubmissionFor(version: 1 | 2, source: RpcValidator<ComposerWireSource>) {
  return rpcObject({
    version: rpcLiteral(version),
    document: rpcOptional(rpcArray(composerDocumentNode(source), { maxLength: 512 })),
    sourceText: rpcString({ maxLength: 200_000 }),
    text: rpcString({ maxLength: 200_000 }),
    mode: rpcOptional(rpcString({ maxLength: 2048 })),
    model: rpcOptional(rpcString({ maxLength: 2048 })),
    context: rpcArray(composerContext, { maxLength: 64 }),
    metadata: rpcRecord(composerJsonValue),
    commands: rpcArray(composerCommand(source), { maxLength: 64 }),
  });
}

const legacyComposerSubmission = composerSubmissionFor(1, rpcEnum(["workbench", "pi"]));
const agentComposerSubmission = composerSubmissionFor(2, rpcEnum(["workbench", "agent"]));
const composerSubmissionWire: RpcValidator<unknown> = (value, path = []) => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const version = (value as { version?: unknown }).version;
    if (version === 1) return legacyComposerSubmission(value, path);
    if (version === 2) return agentComposerSubmission(value, path);
  }
  return rpcUnion([legacyComposerSubmission, agentComposerSubmission])(value, path);
};
const composerSubmission: RpcValidator<WorkbenchComposerSubmission> = (value, path = []) => {
  const validated = composerSubmissionWire(value, path);
  if (!validated.ok) return validated;
  const normalized = parseWorkbenchComposerSubmission(validated.value);
  return normalized
    ? { ok: true, value: normalized }
    : {
        ok: false,
        issues: [{ code: "custom", path: [...path], message: "Invalid Composer submission." }],
      };
};
const sessionPromptPayload = rpcObject({
  sessionId: nonEmptyString,
  mode: rpcEnum(["queue", "steer"]),
  content: rpcArray(
    rpcUnion([promptTextContent, promptImageContent, promptAttachmentContent, promptFileContent]),
  ),
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

async function invokeProtocol<Value>(
  operation: () => Promise<Value>,
  projectDomainError: SessionRpcRoutesDependencies["projectDomainError"],
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    projectDomainError(error);
  }
}

export function createSessionRpcRoutes({
  protocol,
  projectDomainError,
}: SessionRpcRoutesDependencies): SessionRpcRoutes {
  return {
    handle(request, method) {
      switch (method) {
        case "session.list":
          return handleRpcPost(request, {
            method,
            payload: sessionListPayload,
            handler: (payload) => protocol.list(payload),
          });
        case "session.search":
          return handleRpcPost(request, {
            method,
            payload: sessionSearchPayload,
            handler: (payload) =>
              invokeProtocol(() => protocol.search(payload), projectDomainError),
          });
        case "session.create":
          return handleRpcPost(request, {
            method,
            payload: sessionCreatePayload,
            handler: (payload) =>
              invokeProtocol(() => protocol.create(payload), projectDomainError),
          });
        case "session.history":
          return handleRpcPost(request, {
            method,
            payload: sessionHistoryPayload,
            handler: (payload) =>
              invokeProtocol(() => protocol.history(payload), projectDomainError),
          });
        case "session.regenerate":
          return handleRpcPost(request, {
            method,
            payload: sessionRegeneratePayload,
            handler: (payload) =>
              invokeProtocol(() => protocol.regenerate(payload), projectDomainError),
          });
        case "session.resume":
          return handleRpcPost(request, {
            method,
            payload: sessionResumePayload,
            handler: (payload) =>
              invokeProtocol(() => protocol.resume(payload), projectDomainError),
          });
        case "session.selectBranch":
          return handleRpcPost(request, {
            method,
            payload: sessionSelectBranchPayload,
            handler: (payload) =>
              invokeProtocol(() => protocol.selectBranch(payload), projectDomainError),
          });
        case "session.models":
          return handleRpcPost(request, {
            method,
            payload: sessionModelPayload,
            handler: (payload) =>
              invokeProtocol(() => protocol.models(payload), projectDomainError),
          });
        case "session.selectModel":
          return handleRpcPost(request, {
            method,
            payload: sessionSelectModelPayload,
            handler: (payload) =>
              invokeProtocol(() => protocol.selectModel(payload), projectDomainError),
          });
        case "session.contextPolicy":
          return handleRpcPost(request, {
            method,
            payload: sessionModelPayload,
            handler: (payload) =>
              invokeProtocol(() => protocol.contextPolicy(payload), projectDomainError),
          });
        case "session.updateContextPolicy":
          return handleRpcPost(request, {
            method,
            payload: sessionContextPolicyUpdatePayload,
            loopbackOnly: true,
            handler: (payload) =>
              invokeProtocol(() => protocol.updateContextPolicy(payload), projectDomainError),
          });
        case "session.compactContext":
          return handleRpcPost(request, {
            method,
            payload: sessionModelPayload,
            loopbackOnly: true,
            handler: (payload) =>
              invokeProtocol(() => protocol.compactContext(payload), projectDomainError),
          });
        case "session.rename":
          return handleRpcPost(request, {
            method,
            payload: sessionRenamePayload,
            handler: (payload) =>
              invokeProtocol(() => protocol.rename(payload), projectDomainError),
          });
        case "session.delete":
          return handleRpcPost(request, {
            method,
            payload: sessionIdPayload,
            handler: (payload) =>
              invokeProtocol(() => protocol.delete(payload), projectDomainError),
          });
        case "session.fork":
          return handleRpcPost(request, {
            method,
            payload: sessionForkPayload,
            handler: (payload) => invokeProtocol(() => protocol.fork(payload), projectDomainError),
          });
        case "session.scratch.create":
          return handleRpcPost(request, {
            method,
            payload: sessionScratchCreatePayload,
            handler: (payload) =>
              invokeProtocol(() => protocol.scratchCreate(payload), projectDomainError),
          });
        case "session.scratch.release":
          return handleRpcPost(request, {
            method,
            payload: sessionIdPayload,
            handler: (payload) =>
              invokeProtocol(() => protocol.scratchRelease(payload), projectDomainError),
          });
        case "session.scratch.promote":
          return handleRpcPost(request, {
            method,
            payload: sessionScratchPromotePayload,
            handler: (payload) =>
              invokeProtocol(() => protocol.scratchPromote(payload), projectDomainError),
          });
        case "session.prompt":
          return handleRpcPost(request, {
            method,
            payload: sessionPromptPayload,
            maxRequestBodyBytes: RPC_REQUEST_BODY_LIMITS.inlineAttachment,
            handler: (payload, context) =>
              invokeProtocol(
                () => protocol.prompt(payload, { rpcId: context.rpcId }),
                projectDomainError,
              ),
          });
        case "session.attachment":
          return handleRpcPost(request, {
            method,
            payload: sessionAttachmentPayload,
            handler: (payload) =>
              invokeProtocol(() => protocol.attachment(payload), projectDomainError),
          });
        case "session.updateQueue":
          return handleRpcPost(request, {
            method,
            payload: sessionUpdateQueuePayload,
            handler: (payload) =>
              invokeProtocol(() => protocol.updateQueue(payload), projectDomainError),
          });
        case "session.cancel":
          return handleRpcPost(request, {
            method,
            payload: sessionIdPayload,
            handler: (payload) =>
              invokeProtocol(() => protocol.cancel(payload), projectDomainError),
          });
        default:
          return undefined;
      }
    },
  };
}
