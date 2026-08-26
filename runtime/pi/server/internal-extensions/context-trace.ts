import type {
  BuildSystemPromptOptions,
  ExtensionFactory,
  ToolInfo,
} from "@earendil-works/pi-coding-agent";

import type {
  SessionContextTraceCompactionPreparation,
  SessionContextTraceModel,
  SessionContextTraceSystemPromptOptions,
  SessionContextTraceTool,
} from "../../rpc-contracts";
import {
  captureSessionContextTraceJson,
  captureSessionContextTraceText,
  getSessionContextTrace,
} from "../sessions/session-context-trace";

function sessionId(context: { sessionManager: { getSessionId(): string } }): string {
  return context.sessionManager.getSessionId();
}

function modelView(
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

function promptOptionsView(
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

function toolView(tool: ToolInfo, activeTools: ReadonlySet<string>): SessionContextTraceTool {
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

function compactionPreparationView(event: {
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

/**
 * Read-only observer registered last among Workbench inline extensions, so it sees the effective
 * values after user/package extensions have transformed system prompts, messages, and payloads.
 */
export const contextTraceExtension: ExtensionFactory = (pi) => {
  pi.on("before_agent_start", (event, context) => {
    const trace = getSessionContextTrace(sessionId(context));
    if (!trace) return;
    const activeTools = new Set(pi.getActiveTools());
    const contextUsage = context.getContextUsage();
    trace.observePromptComposition({
      type: "prompt-composition",
      prompt: captureSessionContextTraceText(event.prompt),
      systemPrompt: captureSessionContextTraceText(event.systemPrompt),
      systemPromptOptions: promptOptionsView(event.systemPromptOptions),
      images: captureSessionContextTraceJson(event.images ?? []),
      model: modelView(context.model),
      ...(context.thinkingLevel ? { thinkingLevel: context.thinkingLevel } : {}),
      ...(contextUsage ? { contextUsage } : {}),
      tools: pi.getAllTools().map((tool) => toolView(tool, activeTools)),
    });
  });

  pi.on("context", (event, context) => {
    getSessionContextTrace(sessionId(context))?.observeContext(
      event.messages,
      context.getContextUsage(),
    );
  });

  pi.on("session_before_compact", (event, context) => {
    getSessionContextTrace(sessionId(context))?.observeCompactionPreparation(
      event.reason,
      compactionPreparationView(event),
    );
  });

  pi.on("session_compact", (event, context) => {
    getSessionContextTrace(sessionId(context))?.observeCompactionApplied(
      event.reason,
      event.compactionEntry.id,
      event.fromExtension,
    );
  });

  pi.on("before_provider_request", (event, context) => {
    getSessionContextTrace(sessionId(context))?.observeProviderRequest(event.payload);
  });

  pi.on("after_provider_response", (event, context) => {
    getSessionContextTrace(sessionId(context))?.observeProviderResponse(
      event.status,
      event.headers,
    );
  });

  pi.on("message_end", (event, context) => {
    if (event.message.role !== "assistant") return;
    getSessionContextTrace(sessionId(context))?.observeModelOutput(
      event.message,
      modelView(context.model),
      context.thinkingLevel,
    );
  });
};
