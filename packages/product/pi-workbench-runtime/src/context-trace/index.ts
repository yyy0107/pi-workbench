import type { BuildSystemPromptOptions, ToolInfo } from "@earendil-works/pi-coding-agent";

import type {
  SessionContextTraceCompactionPreparation,
  SessionContextTraceModel,
  SessionContextTraceSystemPromptOptions,
  SessionContextTraceSystemPromptSource,
  SessionContextTraceTool,
} from "@workbench/pi-rpc-contracts/rpc";
import {
  captureSessionContextTraceJson,
  captureSessionContextTraceText,
} from "@workbench/pi-sdk-ports/trace-capture";

export function sessionId(context: { sessionManager: { getSessionId(): string } }): string {
  return context.sessionManager.getSessionId();
}

export function modelView(
  model:
    | {
        provider: string;
        id: string;
        api?: string;
        contextWindow?: number;
        maxTokens?: number;
      }
    | undefined,
): SessionContextTraceModel | undefined {
  if (!model) return undefined;
  return {
    provider: model.provider,
    model: model.id,
    ...(model.api ? { api: model.api } : {}),
    ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
    ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
  };
}

export function promptOptionsView(
  options: BuildSystemPromptOptions,
): SessionContextTraceSystemPromptOptions {
  return {
    cwd: options.cwd,
    ...(options.customPrompt
      ? { customPrompt: captureSessionContextTraceText(options.customPrompt) }
      : {}),
    ...(options.appendSystemPrompt
      ? { appendSystemPrompt: captureSessionContextTraceText(options.appendSystemPrompt) }
      : {}),
    ...(options.selectedTools ? { selectedTools: [...options.selectedTools] } : {}),
    ...(options.toolSnippets
      ? {
          toolSnippets: { ...options.toolSnippets },
        }
      : {}),
    ...(options.promptGuidelines ? { promptGuidelines: [...options.promptGuidelines] } : {}),
    contextFiles: (options.contextFiles ?? []).map((file) => ({
      path: file.path,
      content: captureSessionContextTraceText(file.content),
    })),
    skills: (options.skills ?? []).map((skill) => ({
      name: skill.name,
      description: skill.description,
      filePath: skill.filePath,
      disableModelInvocation: skill.disableModelInvocation,
    })),
  };
}

export function fallbackSystemPromptSources(
  options: BuildSystemPromptOptions,
): SessionContextTraceSystemPromptSource[] {
  const sources: SessionContextTraceSystemPromptSource[] = options.customPrompt
    ? [
        {
          kind: "replacement",
          scope: "temporary",
          content: captureSessionContextTraceText(options.customPrompt),
        },
      ]
    : [{ kind: "builtin", scope: "builtin" }];
  if (options.appendSystemPrompt) {
    sources.push({
      kind: "append",
      scope: "temporary",
      content: captureSessionContextTraceText(options.appendSystemPrompt),
    });
  }
  return sources;
}

export function toolView(
  tool: ToolInfo,
  activeTools: ReadonlySet<string>,
): SessionContextTraceTool {
  return {
    name: tool.name,
    description: tool.description,
    active: activeTools.has(tool.name),
    source: {
      path: tool.sourceInfo.path,
      source: tool.sourceInfo.source,
      scope: tool.sourceInfo.scope,
      origin: tool.sourceInfo.origin,
      ...(tool.sourceInfo.baseDir ? { baseDir: tool.sourceInfo.baseDir } : {}),
    },
    parameters: captureSessionContextTraceJson(tool.parameters),
    ...(tool.promptGuidelines ? { promptGuidelines: [...tool.promptGuidelines] } : {}),
  };
}

export function compactionPreparationView(event: {
  preparation: {
    firstKeptEntryId: string;
    messagesToSummarize: unknown[];
    turnPrefixMessages: unknown[];
    isSplitTurn: boolean;
    tokensBefore: number;
    previousSummary?: string;
    fileOps: unknown;
    settings: { reserveTokens: number; keepRecentTokens: number };
  };
  branchEntries: unknown[];
  customInstructions?: string;
}): SessionContextTraceCompactionPreparation {
  const { preparation } = event;
  return {
    firstKeptEntryId: preparation.firstKeptEntryId,
    tokensBefore: preparation.tokensBefore,
    summarizedMessageCount: preparation.messagesToSummarize.length,
    turnPrefixMessageCount: preparation.turnPrefixMessages.length,
    branchEntryCount: event.branchEntries.length,
    isSplitTurn: preparation.isSplitTurn,
    reserveTokens: preparation.settings.reserveTokens,
    keepRecentTokens: preparation.settings.keepRecentTokens,
    ...(preparation.previousSummary
      ? { previousSummary: captureSessionContextTraceText(preparation.previousSummary) }
      : {}),
    ...(event.customInstructions
      ? { customInstructions: captureSessionContextTraceText(event.customInstructions) }
      : {}),
    messagesToSummarize: captureSessionContextTraceJson(preparation.messagesToSummarize),
    turnPrefixMessages: captureSessionContextTraceJson(preparation.turnPrefixMessages),
    fileOperations: captureSessionContextTraceJson(preparation.fileOps),
  };
}
