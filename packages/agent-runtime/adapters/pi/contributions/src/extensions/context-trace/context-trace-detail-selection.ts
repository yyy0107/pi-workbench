import type {
  SessionContextTraceEvent,
  SessionContextTraceSystemPromptOptions,
  SessionContextTraceSystemPromptSource,
  SessionContextTraceTextCapture,
  SessionContextTraceTool,
} from "@workbench/agent-runtime-pi-protocol/rpc";

import type { ContextTraceDetailFocus } from "./context-trace-detail";
import {
  groupContextTraceMessages,
  listContextTraceMessages,
  listContextTraceOutputBlocks,
} from "./context-trace-messages";

function outputMessage(event: SessionContextTraceEvent) {
  return event.kind === "model-output" || event.kind === "turn-end"
    ? event.detail.message
    : undefined;
}

function promptMetadata(event: SessionContextTraceEvent):
  | {
      systemPrompt: SessionContextTraceTextCapture;
      systemPromptWithoutSkills?: SessionContextTraceTextCapture;
      systemPromptSources?: SessionContextTraceSystemPromptSource[];
      systemPromptOptions: SessionContextTraceSystemPromptOptions;
      tools: SessionContextTraceTool[];
    }
  | undefined {
  if (event.kind === "prompt-composition") return event.detail;
  if (
    event.kind === "context-snapshot" &&
    event.detail.systemPrompt &&
    event.detail.systemPromptOptions &&
    event.detail.tools
  ) {
    return {
      systemPrompt: event.detail.systemPrompt,
      systemPromptWithoutSkills: event.detail.systemPromptWithoutSkills,
      systemPromptSources: event.detail.systemPromptSources,
      systemPromptOptions: event.detail.systemPromptOptions,
      tools: event.detail.tools,
    };
  }
  return undefined;
}

function compactionOverview(event: Extract<SessionContextTraceEvent, { kind: "compaction" }>) {
  const { preparation, result } = event.detail;
  return {
    type: event.detail.type,
    phase: event.detail.phase,
    reason: event.detail.reason,
    aborted: event.detail.aborted,
    willRetry: event.detail.willRetry,
    error: event.detail.error,
    preparation: preparation
      ? {
          firstKeptEntryId: preparation.firstKeptEntryId,
          tokensBefore: preparation.tokensBefore,
          summarizedMessageCount: preparation.summarizedMessageCount,
          turnPrefixMessageCount: preparation.turnPrefixMessageCount,
          branchEntryCount: preparation.branchEntryCount,
          isSplitTurn: preparation.isSplitTurn,
          reserveTokens: preparation.reserveTokens,
          keepRecentTokens: preparation.keepRecentTokens,
        }
      : undefined,
    result: result
      ? {
          firstKeptEntryId: result.firstKeptEntryId,
          tokensBefore: result.tokensBefore,
          estimatedTokensAfter: result.estimatedTokensAfter,
          usage: result.usage,
          compactionEntryId: result.compactionEntryId,
          fromExtension: result.fromExtension,
        }
      : undefined,
  };
}

/**
 * Projects the large underlying trace record onto the semantic row selected in the context tree.
 * Several rows deliberately share one trace event, so serializing the event itself would expose
 * unrelated prompt, context, tool, or output sections in the detail pane.
 */
export function contextTraceSelectedRawValue(
  event: SessionContextTraceEvent,
  focus: ContextTraceDetailFocus | undefined,
): unknown {
  if (!focus) return event;
  const metadata = promptMetadata(event);

  if (focus.type === "prompt-section" && metadata) {
    switch (focus.section) {
      case "user-prompt":
        return event.kind === "prompt-composition" ? event.detail.prompt : null;
      case "system-prompt":
        return metadata.systemPromptWithoutSkills ?? metadata.systemPrompt;
      case "skills":
        return metadata.systemPromptOptions.skills;
      case "context-files":
        return metadata.systemPromptOptions.contextFiles;
      case "tool-schema":
        return metadata.tools.filter((tool) => tool.active);
      case "attachments":
        return event.kind === "prompt-composition" ? event.detail.images : null;
    }
  }

  if (focus.type === "system-prompt-source" && metadata) {
    return metadata.systemPromptSources?.[focus.index] ?? null;
  }

  if (focus.type === "prompt-tool" && metadata) {
    return metadata.tools.find((tool) => tool.name === focus.toolName) ?? null;
  }

  if (focus.type === "context-message" && event.kind === "context-snapshot") {
    return (
      listContextTraceMessages(event.detail.messages.value).find(
        (message) => message.sourceIndex === focus.sourceIndex,
      )?.value ?? null
    );
  }

  if (focus.type === "message-role" && event.kind === "context-snapshot") {
    return groupContextTraceMessages(event.detail.messages.value)[focus.role].map(
      (message) => message.value,
    );
  }

  if (
    (focus.type === "output-message" || focus.type === "output-block") &&
    (event.kind === "model-output" || event.kind === "turn-end")
  ) {
    if (focus.type === "output-message") return event.detail.message;
    const block = listContextTraceOutputBlocks(event.detail.message.value).find(
      (candidate) => candidate.contentIndex === focus.contentIndex,
    );
    if (!block) return null;
    if (
      focus.section === "arguments" &&
      typeof block.value === "object" &&
      block.value !== null &&
      !Array.isArray(block.value)
    ) {
      return block.value.arguments ?? null;
    }
    return block.value;
  }

  if (focus.type === "compaction-section" && event.kind === "compaction") {
    switch (focus.section) {
      case "overview":
        return compactionOverview(event);
      case "summary":
        return event.detail.result?.summary ?? null;
      case "messages-to-summarize":
        return event.detail.preparation?.messagesToSummarize ?? null;
      case "turn-prefix":
        return event.detail.preparation?.turnPrefixMessages ?? null;
    }
  }

  if (focus.type === "trace-node") {
    switch (focus.node) {
      case "conversation":
        return event.kind === "context-snapshot" ? event.detail.messages : event.detail;
      case "final-response":
        return outputMessage(event) ?? event.detail;
      case "model-step":
      case "context":
        return event.detail;
    }
  }

  return event.detail;
}
