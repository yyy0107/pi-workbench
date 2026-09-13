import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { BuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import type {
  SessionContextTraceSystemPromptSource,
  SessionContextTraceExtension,
  SessionContextTraceDetail,
  SessionContextTraceContextUsage,
  SessionContextTraceCompactionPreparation,
  SessionContextTraceEventSummary,
} from "@workbench/pi-rpc-contracts/rpc";
/** Existing live-session trace operations consumed by inline observers. No registry or persistence. */
export interface PiToolContextTrace {
  getSystemPromptSources(): readonly SessionContextTraceSystemPromptSource[];
  getSystemPromptOptions(): BuildSystemPromptOptions | undefined;
  observeSystemPromptHookMutation(input: {
    path: string;
    scope: Exclude<SessionContextTraceSystemPromptSource["scope"], "builtin">;
    handlerIndex: number;
    before: string;
    after: string;
  }): void;
  consumeSystemPromptHookSources(
    finalSystemPrompt: string,
  ): SessionContextTraceSystemPromptSource[];
  getExtensions(): readonly SessionContextTraceExtension[];
  observePromptComposition(
    detail: Extract<SessionContextTraceDetail, { type: "prompt-composition" }>,
  ): void;
  observeContext(
    messages: unknown[],
    contextUsage?: SessionContextTraceContextUsage,
    callContext?: Partial<
      Omit<
        Extract<SessionContextTraceDetail, { type: "context-snapshot" }>,
        "type" | "messageCount" | "messages" | "contextUsage" | "messageTokenEstimates"
      >
    >,
  ): void;
  observeTurnStartTimestamp(timestamp: number): void;
  observeCompactionPreparation(
    reason: "manual" | "threshold" | "overflow",
    preparation: SessionContextTraceCompactionPreparation,
  ): void;
  observeCompactionApplied(
    reason: "manual" | "threshold" | "overflow",
    compactionEntryId: string,
    fromExtension: boolean,
  ): void;
  observeProviderRequest(payload: unknown): void;
  observeProviderResponse(status: number, headers: Record<string, string>): void;
  observeModelOutput(
    message: AssistantMessage,
    model?: SessionContextTraceEventSummary["model"],
    thinkingLevel?: string,
  ): void;
}
