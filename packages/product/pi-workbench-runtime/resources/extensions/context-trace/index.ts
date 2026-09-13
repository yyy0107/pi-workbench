import type { ExtensionFactory, BuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import type { PiToolContextTrace } from "@workbench/pi-sdk-ports/tool-trace";
import type {
  SessionContextTraceSystemPromptSource,
  SessionContextTracePromptInjection,
} from "@workbench/pi-rpc-contracts/rpc";
import {
  captureSessionContextTraceJson,
  captureSessionContextTraceText,
} from "@workbench/pi-sdk-ports/trace-capture";
import {
  sessionId,
  modelView,
  promptOptionsView,
  fallbackSystemPromptSources,
  toolView,
  compactionPreparationView,
} from "../../../src/context-trace/index";
/**
 * Read-only observer registered last among Workbench inline extensions, so it sees the effective
 * values after user/package extensions have transformed system prompts, messages, and payloads.
 */
export function createContextTraceExtension(
  getSessionContextTrace: (sessionId: string) => PiToolContextTrace | undefined,
): ExtensionFactory {
  return (pi) => {
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
}
