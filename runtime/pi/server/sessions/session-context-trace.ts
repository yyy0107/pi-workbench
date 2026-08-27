import { randomUUID } from "node:crypto";
import path from "node:path";

import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import {
  estimateTokens,
  type AgentSessionEvent,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";

import type {
  SessionContextTraceCapabilities,
  SessionContextTraceCompactionPreparation,
  SessionContextTraceContextUsage,
  SessionContextTraceActivationsValue,
  SessionContextTraceActivationSummary,
  SessionContextTraceCoordinates,
  SessionContextTraceDetail,
  SessionContextTraceEvent,
  SessionContextTraceEventSummary,
  SessionContextTraceExtension,
  SessionContextTraceJsonCapture,
  SessionContextTraceJsonValue,
  SessionContextTraceListValue,
  SessionContextTraceMessageTokenEstimates,
  SessionContextTracePromptPart,
  SessionContextTracePromptPartsValue,
  SessionContextTraceSystemPromptSource,
  SessionContextTraceTextCapture,
  SessionContextTraceTokenUsage,
} from "../../rpc-contracts";
import {
  SESSION_CONTEXT_TRACE_MAX_PERSISTED_ACTIVATIONS,
  SESSION_CONTEXT_TRACE_MAX_PERSISTED_BYTES,
  SessionContextTraceJournal,
} from "./session-context-trace-journal";
import { summarizeSessionContextTraceEvent } from "./session-context-trace-summary";

export const SESSION_CONTEXT_TRACE_MAX_EVENTS = 512;
export const SESSION_CONTEXT_TRACE_MAX_BYTES = 16 * 1024 * 1024;

type TracePublisher = (event: SessionContextTraceEventSummary) => void;
type SystemPromptSourcesResolver = () => readonly SessionContextTraceSystemPromptSource[];
type ExtensionsResolver = () => readonly SessionContextTraceExtension[];

interface PendingCompactionTrace {
  reason: "manual" | "threshold" | "overflow";
  preparation?: SessionContextTraceCompactionPreparation;
  compactionEntryId?: string;
  fromExtension?: boolean;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function jsonBytes(value: unknown): number {
  const seen = new WeakSet<object>();
  try {
    const serialized = JSON.stringify(value, (_key, current: unknown) => {
      if (typeof current === "bigint") return current.toString();
      if (typeof current === "function") return `[Function ${current.name || "anonymous"}]`;
      if (typeof current === "symbol") return current.toString();
      if (typeof current !== "object" || current === null) return current;
      if (seen.has(current)) return "[Circular]";
      seen.add(current);
      return current;
    });
    return serialized === undefined ? 0 : byteLength(serialized);
  } catch {
    return 0;
  }
}

function systemPromptSourceScope(
  sourcePath: string,
  cwd: string,
  agentDir: string,
  fileName: "SYSTEM.md" | "APPEND_SYSTEM.md",
): SessionContextTraceSystemPromptSource["scope"] {
  const resolvedSource = path.resolve(sourcePath);
  if (resolvedSource === path.resolve(cwd, ".pi", fileName)) return "project";
  if (resolvedSource === path.resolve(agentDir, fileName)) return "user";
  return "temporary";
}

/**
 * Projects Pi's public ResourceLoader state into the exact prompt-file precedence users can
 * reason about. A missing replacement means Pi's built-in prompt is the active base layer.
 */
export function sessionContextTraceSystemPromptSources(
  resourceLoader: ResourceLoader,
  cwd: string,
  agentDir: string,
): SessionContextTraceSystemPromptSource[] {
  const customPrompt = resourceLoader.getSystemPrompt();
  const customPromptPath = resourceLoader.getSystemPromptSource()?.path;
  const sources: SessionContextTraceSystemPromptSource[] = customPrompt
    ? [
        {
          kind: "replacement",
          scope: customPromptPath
            ? systemPromptSourceScope(customPromptPath, cwd, agentDir, "SYSTEM.md")
            : "temporary",
          ...(customPromptPath ? { path: customPromptPath } : {}),
          content: captureSessionContextTraceText(customPrompt),
        },
      ]
    : [{ kind: "builtin", scope: "builtin" }];

  const appendPrompts = resourceLoader.getAppendSystemPrompt();
  const appendSources = resourceLoader.getAppendSystemPromptSources();
  appendPrompts.forEach((content, index) => {
    const sourcePath = appendSources[index]?.path;
    sources.push({
      kind: "append",
      scope: sourcePath
        ? systemPromptSourceScope(sourcePath, cwd, agentDir, "APPEND_SYSTEM.md")
        : "temporary",
      ...(sourcePath ? { path: sourcePath } : {}),
      content: captureSessionContextTraceText(content),
    });
  });
  return sources;
}

function extensionDisplayName(extensionPath: string): string {
  const inline = /^<inline:(.+)>$/u.exec(extensionPath)?.[1];
  if (inline) return inline;
  const base = path.basename(extensionPath);
  const extension = path.extname(base);
  return extension ? base.slice(0, -extension.length) : base;
}

/** Projects Pi's final loaded extension inventory without retaining handler/runtime objects. */
export function sessionContextTraceExtensions(
  resourceLoader: ResourceLoader,
): SessionContextTraceExtension[] {
  return resourceLoader.getExtensions().extensions.map((extension) => ({
    name: extensionDisplayName(extension.path),
    path: extension.path,
    resolvedPath: extension.resolvedPath,
    hidden: extension.hidden === true,
    source: {
      path: extension.sourceInfo.path,
      source: extension.sourceInfo.source,
      scope: extension.sourceInfo.scope,
      origin: extension.sourceInfo.origin,
      ...(extension.sourceInfo.baseDir ? { baseDir: extension.sourceInfo.baseDir } : {}),
    },
  }));
}

function tokenUsageView(usage: Usage): SessionContextTraceTokenUsage {
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    ...(usage.cacheWrite1h === undefined ? {} : { cacheWrite1h: usage.cacheWrite1h }),
    ...(usage.reasoning === undefined ? {} : { reasoning: usage.reasoning }),
    totalTokens: usage.totalTokens,
  };
}

function messageTokenEstimates(
  messages: readonly unknown[],
  cache = new WeakMap<object, number | null>(),
): SessionContextTraceMessageTokenEstimates {
  return {
    method: "pi-estimate-tokens-v1",
    tokens: messages.map((message) => {
      if (typeof message !== "object" || message === null) return null;
      if (cache.has(message)) return cache.get(message) ?? null;
      try {
        const tokens = estimateTokens(message as Parameters<typeof estimateTokens>[0]);
        cache.set(message, tokens);
        return tokens;
      } catch {
        // Observation must not interrupt a model call if a custom message shape is malformed.
        cache.set(message, null);
        return null;
      }
    }),
  };
}

function withLegacyMessageTokenEstimates(
  event: SessionContextTraceEvent,
): SessionContextTraceEvent {
  if (
    event.kind !== "context-snapshot" ||
    event.detail.messageTokenEstimates ||
    !Array.isArray(event.detail.messages.value)
  ) {
    return event;
  }
  return {
    ...event,
    detail: {
      ...event.detail,
      messageTokenEstimates: messageTokenEstimates(event.detail.messages.value),
    },
  };
}

function captureJsonValue(
  value: unknown,
  ancestors: WeakSet<object>,
): SessionContextTraceJsonValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined") return "[Undefined]";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return captureJsonValue(
      { name: value.name, message: value.message, stack: value.stack },
      ancestors,
    );
  }

  if (ancestors.has(value)) return "[Circular]";
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => captureJsonValue(item, ancestors));
    }

    const result: Record<string, SessionContextTraceJsonValue> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      result[entryKey] = captureJsonValue(entryValue, ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

export function captureSessionContextTraceJson(value: unknown): SessionContextTraceJsonCapture {
  const captured = captureJsonValue(value, new WeakSet());
  const capturedBytes = jsonBytes(captured);
  return {
    value: captured,
    capture: {
      originalBytes: jsonBytes(value),
      capturedBytes,
      truncated: false,
      redactedPaths: [],
    },
  };
}

export function captureSessionContextTraceText(value: string): SessionContextTraceTextCapture {
  return {
    text: value,
    originalCharacters: value.length,
    originalBytes: byteLength(value),
    capturedBytes: byteLength(value),
    truncated: false,
    redactedPaths: [],
  };
}

export function captureSessionContextTraceHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  return { ...headers };
}

export const SESSION_CONTEXT_TRACE_CAPABILITIES: SessionContextTraceCapabilities = {
  schemaVersion: 1,
  storage: "bounded-memory",
  durable: false,
  scope: "agent-turn",
  captures: [
    "system-prompt",
    "resource-sources",
    "tools",
    "messages",
    "provider-payload",
    "model-output",
    "tool-execution",
    "token-usage",
    "lifecycle",
  ],
  providerTransportAttempts: "logical-request-only",
  sensitiveValues: "captured",
  maxEvents: SESSION_CONTEXT_TRACE_MAX_EVENTS,
  maxBytes: SESSION_CONTEXT_TRACE_MAX_BYTES,
};

export const PERSISTED_SESSION_CONTEXT_TRACE_CAPABILITIES: SessionContextTraceCapabilities = {
  ...SESSION_CONTEXT_TRACE_CAPABILITIES,
  storage: "persistent-journal",
  durable: true,
  persistence: {
    format: "hash-chained-jsonl",
    maxActivations: SESSION_CONTEXT_TRACE_MAX_PERSISTED_ACTIVATIONS,
    maxBytesPerSession: SESSION_CONTEXT_TRACE_MAX_PERSISTED_BYTES,
  },
};

export class SessionContextTrace {
  readonly sessionId: string;
  readonly activationId: string;
  readonly startedAt: number;
  private readonly publisher?: TracePublisher;
  private readonly journal?: SessionContextTraceJournal;
  private readonly summaries: SessionContextTraceEventSummary[] = [];
  /** Full details exist in memory only when disk persistence could not be initialized. */
  private readonly fallbackDetails: SessionContextTraceEvent[] = [];
  private summaryBytes = 0;
  private nextSequence = 0;
  private roundId: string | undefined;
  private runId: string | undefined;
  private runIndex = -1;
  private turnId: string | undefined;
  private turnIndex: number | undefined;
  private requestIndex = -1;
  private readonly pendingRequests: Array<{ requestId: string; requestIndex: number }> = [];
  private readonly messageTokenEstimateCache = new WeakMap<object, number | null>();
  private agentAttempt: number | undefined;
  private pendingCompaction: PendingCompactionTrace | undefined;
  private systemPromptSourcesResolver: SystemPromptSourcesResolver | undefined;
  private extensionsResolver: ExtensionsResolver | undefined;

  constructor(sessionId: string, publisher?: TracePublisher, journal?: SessionContextTraceJournal) {
    this.sessionId = sessionId;
    this.activationId = journal?.activationId ?? randomUUID();
    this.startedAt = journal?.startedAt ?? Date.now();
    this.publisher = publisher;
    this.journal = journal;
  }

  get capabilities(): SessionContextTraceCapabilities {
    return this.journal
      ? PERSISTED_SESSION_CONTEXT_TRACE_CAPABILITIES
      : SESSION_CONTEXT_TRACE_CAPABILITIES;
  }

  setSystemPromptSourcesResolver(resolver: SystemPromptSourcesResolver): void {
    this.systemPromptSourcesResolver = resolver;
  }

  getSystemPromptSources(): readonly SessionContextTraceSystemPromptSource[] {
    try {
      return this.systemPromptSourcesResolver?.() ?? [];
    } catch {
      // Resource diagnostics must not interrupt a model call.
      return [];
    }
  }

  setExtensionsResolver(resolver: ExtensionsResolver): void {
    this.extensionsResolver = resolver;
  }

  getExtensions(): readonly SessionContextTraceExtension[] {
    try {
      return this.extensionsResolver?.() ?? [];
    } catch {
      // Resource diagnostics must not interrupt a model call.
      return [];
    }
  }

  private coordinates(
    overrides: SessionContextTraceCoordinates = {},
  ): SessionContextTraceCoordinates {
    return {
      ...(this.roundId ? { roundId: this.roundId } : {}),
      ...(this.runId ? { runId: this.runId, runIndex: this.runIndex } : {}),
      ...(this.turnId ? { turnId: this.turnId } : {}),
      ...(this.turnIndex === undefined ? {} : { turnIndex: this.turnIndex }),
      ...(this.agentAttempt === undefined ? {} : { agentAttempt: this.agentAttempt }),
      ...overrides,
    };
  }

  private append<Detail extends SessionContextTraceDetail>(
    detail: Detail,
    coordinates: SessionContextTraceCoordinates = this.coordinates(),
  ): void {
    const seq = this.nextSequence++;
    const traceId = `${this.activationId}:${seq}`;
    const detailBytes = jsonBytes(detail);
    const base = {
      schemaVersion: 1 as const,
      traceId,
      sessionId: this.sessionId,
      activationId: this.activationId,
      seq,
      time: Date.now(),
      kind: detail.type,
      detailBytes,
      truncated: false,
      redacted: false,
      ...coordinates,
    };
    const event = { ...base, detail } as SessionContextTraceEvent;
    const summary = summarizeSessionContextTraceEvent(event);
    const bytes = jsonBytes(summary);
    this.summaries.push(summary);
    this.summaryBytes += bytes;
    this.journal?.append(event);
    if (!this.journal) this.fallbackDetails.push(event);
    while (
      this.summaries.length > 1 &&
      (this.summaries.length > SESSION_CONTEXT_TRACE_MAX_EVENTS ||
        this.summaryBytes > SESSION_CONTEXT_TRACE_MAX_BYTES)
    ) {
      const removed = this.summaries.shift();
      if (removed) this.summaryBytes -= jsonBytes(removed);
      if (!this.journal) this.fallbackDetails.shift();
    }
    try {
      this.publisher?.(summary);
    } catch {
      // Observation must never interrupt the agent loop.
    }
  }

  private ensureRound(trigger: "prompt" | "continuation" | "unknown"): void {
    if (this.roundId) return;
    this.roundId = randomUUID();
    this.runId = undefined;
    this.runIndex = -1;
    this.turnId = undefined;
    this.turnIndex = undefined;
    this.requestIndex = -1;
    this.pendingRequests.length = 0;
    this.agentAttempt = undefined;
    this.append({ type: "round-start", trigger }, this.coordinates());
  }

  observePromptComposition(
    detail: Extract<SessionContextTraceDetail, { type: "prompt-composition" }>,
  ): void {
    this.ensureRound("prompt");
    this.append(detail);
  }

  observeContext(messages: unknown[], contextUsage?: SessionContextTraceContextUsage): void {
    this.ensureRound("unknown");
    this.append({
      type: "context-snapshot",
      messageCount: messages.length,
      messages: captureSessionContextTraceJson(messages),
      ...(contextUsage ? { contextUsage } : {}),
      messageTokenEstimates: messageTokenEstimates(messages, this.messageTokenEstimateCache),
    });
  }

  observeCompactionPreparation(
    reason: PendingCompactionTrace["reason"],
    preparation: SessionContextTraceCompactionPreparation,
  ): void {
    const pending = this.pendingCompaction;
    this.pendingCompaction = {
      reason,
      preparation,
      ...(pending?.reason === reason && pending.compactionEntryId
        ? { compactionEntryId: pending.compactionEntryId }
        : {}),
      ...(pending?.reason === reason && pending.fromExtension !== undefined
        ? { fromExtension: pending.fromExtension }
        : {}),
    };
  }

  observeCompactionApplied(
    reason: PendingCompactionTrace["reason"],
    compactionEntryId: string,
    fromExtension: boolean,
  ): void {
    const pending = this.pendingCompaction;
    this.pendingCompaction = {
      reason,
      ...(pending?.reason === reason && pending.preparation
        ? { preparation: pending.preparation }
        : {}),
      compactionEntryId,
      fromExtension,
    };
  }

  observeProviderRequest(payload: unknown): void {
    this.ensureRound("unknown");
    const requestId = randomUUID();
    const requestIndex = ++this.requestIndex;
    this.pendingRequests.push({ requestId, requestIndex });
    this.append(
      {
        type: "provider-request",
        payload: captureSessionContextTraceJson(payload),
        transportAttemptsObserved: false,
      },
      this.coordinates({ requestId, requestIndex }),
    );
  }

  observeProviderResponse(status: number, headers: Record<string, string>): void {
    this.ensureRound("unknown");
    const request = this.pendingRequests.shift();
    const requestId = request?.requestId ?? randomUUID();
    this.append(
      {
        type: "provider-response",
        status,
        headers: captureSessionContextTraceHeaders(headers),
      },
      this.coordinates({
        requestId,
        ...(request ? { requestIndex: request.requestIndex } : {}),
      }),
    );
  }

  observeModelOutput(
    message: AssistantMessage,
    model?: SessionContextTraceEventSummary["model"],
    thinkingLevel?: string,
  ): void {
    this.ensureRound("unknown");
    this.append({
      type: "model-output",
      message: captureSessionContextTraceJson(message),
      usage: tokenUsageView(message.usage),
      ...(model ? { model } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    });
  }

  observeAgentEvent(event: AgentSessionEvent): void {
    switch (event.type) {
      case "agent_start":
        this.ensureRound("continuation");
        this.runId = randomUUID();
        this.runIndex += 1;
        this.turnId = undefined;
        this.turnIndex = undefined;
        this.requestIndex = -1;
        this.pendingRequests.length = 0;
        this.append({ type: "run-start" });
        return;
      case "turn_start":
        this.ensureRound("unknown");
        this.turnIndex = (this.turnIndex ?? -1) + 1;
        this.turnId = randomUUID();
        this.requestIndex = -1;
        this.pendingRequests.length = 0;
        this.append({ type: "turn-start" });
        return;
      case "turn_end": {
        const usage =
          event.message.role === "assistant" ? tokenUsageView(event.message.usage) : undefined;
        this.append({
          type: "turn-end",
          message: captureSessionContextTraceJson(event.message),
          toolResultCount: event.toolResults.length,
          toolResults: captureSessionContextTraceJson(event.toolResults),
          ...(usage ? { usage } : {}),
        });
        this.pendingRequests.length = 0;
        return;
      }
      case "tool_execution_start":
        this.ensureRound("unknown");
        this.append(
          {
            type: "tool-execution-start",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: captureSessionContextTraceJson(event.args),
          },
          this.coordinates({
            toolCallId: event.toolCallId,
            toolName: event.toolName,
          }),
        );
        return;
      case "tool_execution_end":
        this.ensureRound("unknown");
        this.append(
          {
            type: "tool-execution-end",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            result: captureSessionContextTraceJson(event.result),
            isError: event.isError,
          },
          this.coordinates({
            toolCallId: event.toolCallId,
            toolName: event.toolName,
          }),
        );
        return;
      case "agent_end":
        this.turnId = undefined;
        this.turnIndex = undefined;
        this.pendingRequests.length = 0;
        this.append({
          type: "run-end",
          messageCount: event.messages.length,
          willRetry: event.willRetry,
        });
        this.runId = undefined;
        return;
      case "agent_settled":
        this.append({ type: "round-settled" });
        this.roundId = undefined;
        this.runId = undefined;
        this.turnId = undefined;
        this.turnIndex = undefined;
        this.pendingRequests.length = 0;
        this.agentAttempt = undefined;
        return;
      case "auto_retry_start":
        this.agentAttempt = event.attempt;
        this.append({
          type: "retry",
          phase: "scheduled",
          source: "agent",
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          error: captureSessionContextTraceText(event.errorMessage),
        });
        return;
      case "auto_retry_end":
        this.append({
          type: "retry",
          phase: "finished",
          source: "agent",
          attempt: event.attempt,
          success: event.success,
          ...(event.finalError ? { error: captureSessionContextTraceText(event.finalError) } : {}),
        });
        return;
      case "summarization_retry_scheduled":
        this.append({
          type: "retry",
          phase: "summarization-scheduled",
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          error: captureSessionContextTraceText(event.errorMessage),
        });
        return;
      case "summarization_retry_finished":
        this.append({ type: "retry", phase: "summarization-finished" });
        return;
      case "compaction_start":
        this.pendingCompaction = { reason: event.reason };
        this.append({ type: "compaction", phase: "start", reason: event.reason });
        return;
      case "compaction_end": {
        const pending =
          this.pendingCompaction?.reason === event.reason ? this.pendingCompaction : undefined;
        const result = event.result
          ? {
              summary: captureSessionContextTraceText(event.result.summary),
              firstKeptEntryId: event.result.firstKeptEntryId,
              tokensBefore: event.result.tokensBefore,
              ...(event.result.estimatedTokensAfter === undefined
                ? {}
                : { estimatedTokensAfter: event.result.estimatedTokensAfter }),
              ...(event.result.usage ? { usage: tokenUsageView(event.result.usage) } : {}),
              ...(event.result.details === undefined
                ? {}
                : { details: captureSessionContextTraceJson(event.result.details) }),
              ...(pending?.compactionEntryId
                ? { compactionEntryId: pending.compactionEntryId }
                : {}),
              ...(pending?.fromExtension === undefined
                ? {}
                : { fromExtension: pending.fromExtension }),
            }
          : undefined;
        this.append({
          type: "compaction",
          phase: "end",
          reason: event.reason,
          aborted: event.aborted,
          willRetry: event.willRetry,
          ...(pending?.preparation ? { preparation: pending.preparation } : {}),
          ...(result ? { result } : {}),
          ...(event.errorMessage
            ? { error: captureSessionContextTraceText(event.errorMessage) }
            : {}),
        });
        this.pendingCompaction = undefined;
        return;
      }
      default:
        return;
    }
  }

  list(afterSeq = -1, limit = 100): SessionContextTraceListValue {
    const matching = this.summaries.filter((event) => event.seq > afterSeq);
    const events = matching.slice(0, limit);
    return {
      activationId: this.activationId,
      events,
      hasMore: matching.length > events.length,
      nextSeq: this.nextSequence,
      retainedFromSeq: this.summaries.at(0)?.seq ?? this.nextSequence,
      capabilities: this.capabilities,
      source: "memory",
      integrity: "memory",
    };
  }

  read(traceId: string): SessionContextTraceEvent | undefined {
    const event = this.fallbackDetails.find((candidate) => candidate.traceId === traceId);
    return event ? withLegacyMessageTokenEstimates(event) : undefined;
  }

  async activations(): Promise<SessionContextTraceActivationsValue> {
    await this.journal?.flush();
    const current: SessionContextTraceActivationSummary = this.journal?.summary(true) ?? {
      schemaVersion: 1,
      sessionId: this.sessionId,
      activationId: this.activationId,
      startedAt: this.startedAt,
      updatedAt: this.summaries.at(-1)?.time ?? this.startedAt,
      eventCount: this.nextSequence,
      persistedBytes: 0,
      active: true,
      complete: false,
    };
    let persisted: SessionContextTraceActivationSummary[] = [];
    try {
      persisted = await SessionContextTraceJournal.listActivations(
        this.sessionId,
        this.activationId,
      );
    } catch (error) {
      if (this.journal) throw error;
    }
    return {
      activations: persisted.some((item) => item.activationId === this.activationId)
        ? persisted.map((item) => (item.activationId === this.activationId ? current : item))
        : [current, ...persisted],
      currentActivationId: this.activationId,
      capabilities: this.capabilities,
    };
  }

  async listActivation(
    activationId: string | undefined,
    afterSeq = -1,
    limit = 100,
  ): Promise<SessionContextTraceListValue> {
    if (!activationId || activationId === this.activationId) {
      const memoryPage = this.list(afterSeq, limit);
      const missesRetainedHistory = afterSeq + 1 < memoryPage.retainedFromSeq;
      const hasLegacyPromptSummary = memoryPage.events.some(
        (event) => event.kind === "prompt-composition" && event.promptPreview === undefined,
      );
      if (!this.journal || (!missesRetainedHistory && !hasLegacyPromptSummary)) {
        return memoryPage;
      }

      await this.journal.flush();
      const page = await SessionContextTraceJournal.readActivation(
        this.sessionId,
        this.activationId,
        afterSeq,
        limit,
      );
      return {
        ...page,
        capabilities: this.capabilities,
        source: "disk",
        integrity: "verified",
      };
    }
    await this.journal?.flush();
    const page = await SessionContextTraceJournal.readActivation(
      this.sessionId,
      activationId,
      afterSeq,
      limit,
    );
    return {
      ...page,
      capabilities: this.capabilities,
      source: "disk",
      integrity: "verified",
    };
  }

  async readAny(traceId: string): Promise<SessionContextTraceEvent | undefined> {
    const current = this.read(traceId);
    if (current) return current;
    await this.journal?.flush();
    const event = await SessionContextTraceJournal.readEvent(this.sessionId, traceId);
    return event ? withLegacyMessageTokenEstimates(event) : undefined;
  }

  async close(): Promise<void> {
    await this.journal?.close();
  }
}

interface SessionContextTraceRegistryState {
  traces: Map<string, SessionContextTrace>;
}

const serverGlobal = globalThis as typeof globalThis & {
  __workbenchPiSessionContextTraces?: SessionContextTraceRegistryState;
};

function registry(): SessionContextTraceRegistryState {
  serverGlobal.__workbenchPiSessionContextTraces ??= { traces: new Map() };
  return serverGlobal.__workbenchPiSessionContextTraces;
}

export async function activateSessionContextTrace(
  sessionId: string,
  publisher?: TracePublisher,
): Promise<SessionContextTrace> {
  let journal: SessionContextTraceJournal | undefined;
  // The Node test runner frequently removes its temporary Pi home before global session
  // teardown. Persistence tests opt back in with an explicit journal root.
  const testHarnessWithoutJournalRoot =
    process.env.NODE_TEST_CONTEXT !== undefined &&
    !process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR?.trim();
  if (!testHarnessWithoutJournalRoot) {
    try {
      journal = await SessionContextTraceJournal.create(sessionId);
    } catch (error) {
      console.error("[workbench-pi] context trace journal unavailable", error);
    }
  }
  const trace = new SessionContextTrace(sessionId, publisher, journal);
  registry().traces.set(sessionId, trace);
  return trace;
}

export function getSessionContextTrace(sessionId: string): SessionContextTrace | undefined {
  return registry().traces.get(sessionId);
}

function promptPartsFromSummaries(
  summaries: readonly SessionContextTraceEventSummary[],
): SessionContextTracePromptPart[] {
  const modelOutputsByRound = new Map<string, Array<{ order: number; messageTimestamp: number }>>();
  summaries.forEach((event, order) => {
    if (event.kind !== "model-output" || !event.roundId || event.messageTimestamp === undefined) {
      return;
    }
    const outputs = modelOutputsByRound.get(event.roundId) ?? [];
    outputs.push({ order, messageTimestamp: event.messageTimestamp });
    modelOutputsByRound.set(event.roundId, outputs);
  });

  const parts: SessionContextTracePromptPart[] = [];
  summaries.forEach((event, order) => {
    if (event.kind !== "prompt-composition") return;
    const output = event.roundId
      ? modelOutputsByRound.get(event.roundId)?.find((candidate) => candidate.order > order)
      : undefined;
    parts.push({
      event,
      ...(output ? { assistantMessageTimestamp: output.messageTimestamp } : {}),
    });
  });
  return parts;
}

/**
 * Replays the durable journal without starting an idle Pi host. Only the prompt-composition
 * projection crosses the chat-runtime boundary; all other trace details remain journal-only.
 */
export async function readSessionContextTracePromptParts(
  sessionId: string,
): Promise<SessionContextTracePromptPartsValue> {
  const activeTrace = getSessionContextTrace(sessionId);
  const activationValue = activeTrace
    ? await activeTrace.activations()
    : {
        activations: await SessionContextTraceJournal.listActivations(sessionId),
        capabilities: PERSISTED_SESSION_CONTEXT_TRACE_CAPABILITIES,
      };
  const activations = [...activationValue.activations].sort(
    (left, right) => left.startedAt - right.startedAt,
  );
  const summaries: SessionContextTraceEventSummary[] = [];
  let source: "memory" | "disk" = "disk";
  let integrity: "memory" | "verified" = "verified";

  for (const activation of activations) {
    const limit = Math.max(1, activation.eventCount);
    if (activeTrace) {
      const page = await activeTrace.listActivation(activation.activationId, -1, limit);
      summaries.push(...page.events);
      if (page.source === "memory") source = "memory";
      if (page.integrity === "memory") integrity = "memory";
      continue;
    }
    const page = await SessionContextTraceJournal.readActivation(
      sessionId,
      activation.activationId,
      -1,
      limit,
    );
    summaries.push(...page.events);
  }

  return {
    parts: promptPartsFromSummaries(summaries),
    capabilities: activationValue.capabilities,
    source,
    integrity,
  };
}

export async function releaseSessionContextTrace(
  sessionId: string,
  expected: SessionContextTrace,
): Promise<void> {
  if (registry().traces.get(sessionId) === expected) registry().traces.delete(sessionId);
  try {
    await expected.close();
  } catch (error) {
    console.error("[workbench-pi] context trace journal flush failed", error);
  }
}
