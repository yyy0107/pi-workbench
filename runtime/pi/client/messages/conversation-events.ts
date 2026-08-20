import type { ThreadMessage } from "@assistant-ui/react";

import {
  PI_CONVERSATION_EVENT_CUSTOM_TYPE,
  PI_MODEL_CHANGED_EVENT,
  type PiCompactionConversationEvent,
  type PiConversationEvent,
  type PiCustomMessage,
  type PiModelChangeConversationEvent,
} from "../../contracts";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function parsePiConversationEvent(value: unknown): PiConversationEvent | undefined {
  const candidate = record(value);
  if (candidate?.kind === "model-change") {
    const model = optionalString(candidate.model);
    if (!model) return undefined;
    return {
      kind: "model-change",
      model,
      ...(optionalString(candidate.provider) ? { provider: String(candidate.provider) } : {}),
      ...(optionalString(candidate.previousModel)
        ? { previousModel: String(candidate.previousModel) }
        : {}),
      ...(optionalString(candidate.previousProvider)
        ? { previousProvider: String(candidate.previousProvider) }
        : {}),
    };
  }

  if (candidate?.kind === "compaction") {
    const reason = optionalString(candidate.reason);
    if (!reason) return undefined;
    return {
      kind: "compaction",
      reason,
      ...(finiteNumber(candidate.tokensBefore) === undefined
        ? {}
        : { tokensBefore: finiteNumber(candidate.tokensBefore) }),
      ...(finiteNumber(candidate.estimatedTokensAfter) === undefined
        ? {}
        : { estimatedTokensAfter: finiteNumber(candidate.estimatedTokensAfter) }),
    };
  }

  return undefined;
}

export function modelChangeConversationEvent(
  model: string | undefined,
  provider: string | undefined,
  previousModel?: string,
  previousProvider?: string,
): PiModelChangeConversationEvent | undefined {
  if (!model || (model === previousModel && provider === previousProvider)) return undefined;
  return {
    kind: "model-change",
    model,
    ...(provider ? { provider } : {}),
    ...(previousModel ? { previousModel } : {}),
    ...(previousProvider ? { previousProvider } : {}),
  };
}

export function conversationEventFromSessionEvent(
  type: string,
  value: unknown,
): PiConversationEvent | undefined {
  const data = record(value);
  if (type === PI_MODEL_CHANGED_EVENT) {
    return modelChangeConversationEvent(
      optionalString(data?.model),
      optionalString(data?.provider),
      optionalString(data?.previousModel),
      optionalString(data?.previousProvider),
    );
  }

  if (type !== "compaction_end" || data?.aborted === true) return undefined;
  const result = record(data?.result);
  if (!result) return undefined;
  return {
    kind: "compaction",
    reason: optionalString(data?.reason) ?? "unknown",
    ...(finiteNumber(result.tokensBefore) === undefined
      ? {}
      : { tokensBefore: finiteNumber(result.tokensBefore) }),
    ...(finiteNumber(result.estimatedTokensAfter) === undefined
      ? {}
      : { estimatedTokensAfter: finiteNumber(result.estimatedTokensAfter) }),
  } satisfies PiCompactionConversationEvent;
}

export function piConversationEventMessage(
  event: PiConversationEvent,
  timestamp: number,
): PiCustomMessage {
  return {
    role: "custom",
    customType: PI_CONVERSATION_EVENT_CUSTOM_TYPE,
    content: "",
    display: true,
    details: event,
    timestamp,
  };
}

export function conversationEventThreadMessage(
  event: PiConversationEvent,
  id: string,
  timestamp: number,
): ThreadMessage {
  return {
    id,
    role: "system",
    content: [{ type: "text", text: "" }],
    createdAt: new Date(timestamp),
    metadata: {
      custom: {
        piCustomType: PI_CONVERSATION_EVENT_CUSTOM_TYPE,
        piConversationEvent: event,
      },
    },
  };
}
