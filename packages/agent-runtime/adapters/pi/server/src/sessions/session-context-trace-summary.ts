import type {
  SessionContextTraceEvent,
  SessionContextTraceEventSummary,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import { deriveSessionDisplayTitle } from "@workbench/agent-runtime-pi-shared/sessions";

const PROMPT_PREVIEW_CHARACTERS = 32;

export function sessionContextTracePromptPreview(prompt: string): string | undefined {
  return (
    deriveSessionDisplayTitle(prompt, { maxCharacters: PROMPT_PREVIEW_CHARACTERS + 1 }) || undefined
  );
}

function capturedMessageTimestamp(event: SessionContextTraceEvent): number | undefined {
  if (event.detail.type !== "model-output" && event.detail.type !== "turn-end") return undefined;
  const value = event.detail.message.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const timestamp = value.timestamp;
  return typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : undefined;
}

export function summarizeSessionContextTraceEvent(
  event: SessionContextTraceEvent,
): SessionContextTraceEventSummary {
  const { detail, ...summary } = event;
  const messageTimestamp = capturedMessageTimestamp(event);
  const promptPreview =
    detail.type === "prompt-composition"
      ? sessionContextTracePromptPreview(detail.prompt.text)
      : undefined;
  const contextUsage =
    detail.type === "prompt-composition" || detail.type === "context-snapshot"
      ? detail.contextUsage
      : undefined;
  const promptResources =
    detail.type === "prompt-composition"
      ? {
          systemPromptCharacters: detail.systemPrompt.originalCharacters,
          systemPromptSourceCount: detail.systemPromptSources?.length ?? 0,
          systemPromptSources: (detail.systemPromptSources ?? []).map((source) => ({
            kind: source.kind,
            scope: source.scope,
            ...(source.path ? { path: source.path } : {}),
            ...(source.hook ? { hook: source.hook } : {}),
            ...(source.handlerIndex === undefined ? {} : { handlerIndex: source.handlerIndex }),
          })),
          contextFileCount: detail.systemPromptOptions.contextFiles.length,
          contextFiles: detail.systemPromptOptions.contextFiles.map((file) => file.path),
          skills: detail.systemPromptOptions.skills.map((skill) => ({
            name: skill.name,
            disableModelInvocation: skill.disableModelInvocation === true,
          })),
          extensions: (detail.extensions ?? []).map((extension) => ({
            name: extension.name,
            hidden: extension.hidden,
          })),
          tools: {
            active: detail.tools.filter((tool) => tool.active).map((tool) => tool.name),
            total: detail.tools.length,
          },
        }
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
    ...(messageTimestamp === undefined ? {} : { messageTimestamp }),
    ...(promptPreview ? { promptPreview } : {}),
    ...(promptResources ? { promptResources } : {}),
    ...(contextUsage ? { contextUsage } : {}),
    ...(compaction ? { compaction } : {}),
    ...(detail.type === "model-output"
      ? {
          usage: detail.usage,
          ...(detail.model ? { model: detail.model } : {}),
          ...(detail.thinkingLevel ? { thinkingLevel: detail.thinkingLevel } : {}),
        }
      : {}),
    ...(detail.type === "context-snapshot"
      ? {
          ...(detail.systemPrompt && detail.systemPromptOptions && detail.tools
            ? { callContextCaptured: true as const }
            : {}),
          ...(detail.model ? { model: detail.model } : {}),
          ...(detail.thinkingLevel ? { thinkingLevel: detail.thinkingLevel } : {}),
        }
      : {}),
    ...(detail.type === "turn-end" && detail.usage ? { usage: detail.usage } : {}),
  };
}
