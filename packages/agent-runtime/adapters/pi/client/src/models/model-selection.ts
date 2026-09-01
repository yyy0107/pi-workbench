import type { AppendMessage } from "@assistant-ui/react";

import { isPiThinkingLevel } from "@workbench/agent-runtime-pi-protocol/messages";
import type { SessionSelectModelPayload } from "@workbench/agent-runtime-pi-protocol/rpc";

export type DraftSessionModelSelection = Omit<SessionSelectModelPayload, "sessionId">;

/**
 * A draft can carry its composer model into the session created for its first
 * prompt. Once a remote session exists, its server-owned selection must never
 * be overwritten implicitly by message metadata.
 */
export function draftSessionModelSelection(
  remoteId: string | undefined,
  message: AppendMessage,
): DraftSessionModelSelection | undefined {
  if (remoteId) return undefined;
  const candidate = message.metadata?.custom?.piModel;
  if (!candidate || typeof candidate !== "object") return undefined;
  const selection = candidate as Record<string, unknown>;
  if (typeof selection.provider !== "string" || typeof selection.modelId !== "string") {
    return undefined;
  }
  const reasoningEffort = isPiThinkingLevel(selection.thinkingLevel)
    ? selection.thinkingLevel
    : undefined;
  return {
    provider: selection.provider,
    model: selection.modelId,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}
