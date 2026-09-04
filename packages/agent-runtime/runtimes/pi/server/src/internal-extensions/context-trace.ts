import type {
  BuildSystemPromptOptions,
  ExtensionFactory,
  ToolInfo,
} from "@earendil-works/pi-coding-agent";

import type {
  SessionContextTraceCompactionPreparation,
  SessionContextTraceModel,
  SessionContextTracePromptInjection,
  SessionContextTraceSystemPromptOptions,
  SessionContextTraceSystemPromptSource,
  SessionContextTraceTool,
} from "@workbench/agent-runtime-pi-protocol/rpc";
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

function fallbackSystemPromptSources(
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
  let latestPromptMetadata:
    | {
        systemPrompt: string;
        options: BuildSystemPromptOptions;
        sources: SessionContextTraceSystemPromptSource[];
      }
    | undefined;
  let pendingPromptInput: { prompt: string; images: unknown } | undefined;

  pi.on("turn_start", (event, context) => {
    getSessionContextTrace(sessionId(context))?.observeTurnStartTimestamp(event.timestamp);
  });

  pi.on("before_agent_start", (event, context) => {
    const trace = getSessionContextTrace(sessionId(context));
    if (!trace) return;
    const systemPromptSources = trace.getSystemPromptSources();
    const systemPromptHookSources = trace.consumeSystemPromptHookSources(event.systemPrompt);
    const effectiveSources =
      systemPromptSources.length > 0
        ? [...systemPromptSources.map((source) => ({ ...source })), ...systemPromptHookSources]
        : [...fallbackSystemPromptSources(event.systemPromptOptions), ...systemPromptHookSources];
    latestPromptMetadata = {
      systemPrompt: event.systemPrompt,
      options: event.systemPromptOptions,
      sources: effectiveSources,
    };
    pendingPromptInput = { prompt: event.prompt, images: event.images ?? [] };
  });

  pi.on("context", (event, context) => {
    const trace = getSessionContextTrace(sessionId(context));
    if (!trace) return;
    const systemPrompt = context.getSystemPrompt();
    const promptMetadata =
      latestPromptMetadata?.systemPrompt === systemPrompt ? latestPromptMetadata : undefined;
    const activeToolNames = pi.getActiveTools();
    const activeTools = new Set(activeToolNames);
    const allTools = pi.getAllTools();
    const baseOptions = promptMetadata?.options ??
      trace.getSystemPromptOptions() ?? {
        cwd: context.cwd,
      };
    const { toolSnippets: baseToolSnippets, ...resourceOptions } = baseOptions;
    const toolSnippets = Object.fromEntries(
      Object.entries(baseToolSnippets ?? {}).filter(([name]) => activeTools.has(name)),
    );
    const currentOptions: BuildSystemPromptOptions = {
      ...resourceOptions,
      selectedTools: activeToolNames,
      ...(Object.keys(toolSnippets).length > 0 ? { toolSnippets } : {}),
      promptGuidelines: [
        ...new Set(
          allTools
            .filter((tool) => activeTools.has(tool.name))
            .flatMap((tool) => tool.promptGuidelines ?? [])
            .map((guideline) => guideline.trim())
            .filter(Boolean),
        ),
      ],
    };
    const systemPromptSources = trace.getSystemPromptSources();
    const extensions = trace.getExtensions().map((extension) => ({
      ...extension,
      source: { ...extension.source },
    }));
    const promptInjections: SessionContextTracePromptInjection[] = [];
    if (systemPrompt.length > 0) promptInjections.push("system-prompt");
    if (activeTools.size > 0) promptInjections.push("tools");
    if (extensions.some((extension) => !extension.hidden)) promptInjections.push("extensions");
    const promptInput = pendingPromptInput;
    const contextUsage = context.getContextUsage();
    pendingPromptInput = undefined;

    // Pi invokes `context` immediately before every model call, including continuations and
    // post-tool turns that do not emit `before_agent_start`.
    trace.observePromptComposition({
      type: "prompt-composition",
      prompt: captureSessionContextTraceText(promptInput?.prompt ?? ""),
      systemPrompt: captureSessionContextTraceText(systemPrompt),
      systemPromptSources:
        promptMetadata?.sources ??
        (systemPromptSources.length > 0
          ? [...systemPromptSources]
          : fallbackSystemPromptSources(currentOptions)),
      systemPromptOptions: promptOptionsView(currentOptions),
      images: captureSessionContextTraceJson(promptInput?.images ?? []),
      model: modelView(context.model),
      ...(context.thinkingLevel ? { thinkingLevel: context.thinkingLevel } : {}),
      ...(contextUsage ? { contextUsage } : {}),
      tools: allTools.map((tool) => toolView(tool, activeTools)),
      extensions,
      promptInjections,
    });

    trace.observeContext(event.messages, contextUsage, {
      systemPrompt: captureSessionContextTraceText(systemPrompt),
      systemPromptSources:
        promptMetadata?.sources ??
        (systemPromptSources.length > 0
          ? [...systemPromptSources]
          : fallbackSystemPromptSources(currentOptions)),
      systemPromptOptions: promptOptionsView(currentOptions),
      tools: allTools.map((tool) => toolView(tool, activeTools)),
      extensions,
      model: modelView(context.model),
      ...(context.thinkingLevel ? { thinkingLevel: context.thinkingLevel } : {}),
    });
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
