import type {
  SessionContextTraceEvent,
  SessionContextTraceEventSummary,
} from "../../rpc-contracts";
import { sessionContextTracePromptPreview } from "../../context-trace-preview";

export { sessionContextTracePromptPreview } from "../../context-trace-preview";

export function summarizeSessionContextTraceEvent(
  event: SessionContextTraceEvent,
): SessionContextTraceEventSummary {
  const { detail, ...summary } = event;
  const promptPreview =
    detail.type === "prompt-composition"
      ? sessionContextTracePromptPreview(detail.prompt.text)
      : undefined;
  const contextUsage =
    detail.type === "prompt-composition" || detail.type === "context-snapshot"
      ? detail.contextUsage
      : undefined;
  const compaction =
    detail.type === "compaction"
      ? {
          phase: detail.phase,
          reason: detail.reason,
          ...(detail.result
            ? {
                tokensBefore: detail.result.tokensBefore,
                ...(detail.result.estimatedTokensAfter === undefined
                  ? {}
                  : { estimatedTokensAfter: detail.result.estimatedTokensAfter }),
                firstKeptEntryId: detail.result.firstKeptEntryId,
              }
            : detail.preparation
              ? {
                  tokensBefore: detail.preparation.tokensBefore,
                  firstKeptEntryId: detail.preparation.firstKeptEntryId,
                }
              : {}),
          ...(detail.preparation
            ? {
                summarizedMessageCount: detail.preparation.summarizedMessageCount,
                turnPrefixMessageCount: detail.preparation.turnPrefixMessageCount,
              }
            : {}),
          ...(detail.aborted === undefined ? {} : { aborted: detail.aborted }),
          ...(detail.willRetry === undefined ? {} : { willRetry: detail.willRetry }),
        }
      : undefined;
  return {
    ...summary,
    ...(promptPreview ? { promptPreview } : {}),
    ...(contextUsage ? { contextUsage } : {}),
    ...(compaction ? { compaction } : {}),
    ...(detail.type === "model-output"
      ? {
          usage: detail.usage,
          ...(detail.model ? { model: detail.model } : {}),
          ...(detail.thinkingLevel ? { thinkingLevel: detail.thinkingLevel } : {}),
        }
      : {}),
    ...(detail.type === "turn-end" && detail.usage ? { usage: detail.usage } : {}),
  };
}
