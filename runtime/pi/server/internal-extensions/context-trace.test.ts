import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith(".") &&
      !/\.[^/]+$/.test(specifier) &&
      context.parentURL?.includes("/runtime/pi/")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { contextTraceExtension } = await import("./context-trace");
const { activateSessionContextTrace, releaseSessionContextTrace } =
  await import("../sessions/session-context-trace");
const { SessionContextTraceJournal } = await import("../sessions/session-context-trace-journal");

test.after(() => moduleHooks.deregister());

test("observes final prompt resources, messages, tools, and provider payload without mutation", async (t) => {
  const traceDirectory = await mkdtemp(path.join(tmpdir(), "workbench-context-trace-extension-"));
  const previousTraceDirectory = process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR;
  process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR = traceDirectory;
  t.after(async () => {
    if (previousTraceDirectory === undefined) delete process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR;
    else process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR = previousTraceDirectory;
    await rm(traceDirectory, { recursive: true, force: true });
  });
  const handlers = new Map<string, (event: never, context: never) => unknown>();
  const longText = "x".repeat(140 * 1024);
  const selectedTools = Array.from({ length: 300 }, (_, index) => `tool-${index}`);
  const toolSnippets = Object.fromEntries(
    Array.from({ length: 300 }, (_, index) => [`tool-${index}`, `snippet-${index}`]),
  );
  const promptGuidelines = Array.from({ length: 300 }, (_, index) => `guideline-${index}`);
  const contextFiles = Array.from({ length: 129 }, (_, index) => ({
    path: `/workspace/context-${index}.md`,
    content: index === 128 ? longText : `context-${index}`,
  }));
  const skills = Array.from({ length: 129 }, (_, index) => ({
    name: `skill-${index}`,
    description: index === 128 ? longText : `skill description ${index}`,
    filePath: `/skills/skill-${index}/SKILL.md`,
    baseDir: `/skills/skill-${index}`,
    sourceInfo: {
      path: `/skills/skill-${index}/SKILL.md`,
      source: "settings",
      scope: "user",
      origin: "top-level",
    },
    disableModelInvocation: false,
  }));
  const tools = Array.from({ length: 513 }, (_, index) => ({
    name: `tool-${index}`,
    description: index === 512 ? longText : `Tool ${index}`,
    parameters: { type: "object", properties: { value: { type: "string" } } },
    promptGuidelines: [index === 512 ? longText : `Use tool ${index}.`],
    sourceInfo: {
      path: `<built-in:tool-${index}>`,
      source: "built-in",
      scope: "temporary",
      origin: "top-level",
    },
  }));
  const pi = {
    on(event: string, handler: (event: never, context: never) => unknown) {
      handlers.set(event, handler);
    },
    getActiveTools: () => ["tool-512"],
    getAllTools: () => tools,
  };
  contextTraceExtension(pi as never);

  const trace = await activateSessionContextTrace("session-1");
  const context = {
    sessionManager: { getSessionId: () => "session-1" },
    model: {
      provider: "acme",
      id: "model-1",
      api: "openai-responses",
      contextWindow: 128_000,
      maxTokens: 8_192,
    },
    thinkingLevel: "high",
    getContextUsage: () => ({ tokens: 100, contextWindow: 128_000, percent: 0.078125 }),
  };

  await handlers.get("before_agent_start")?.(
    {
      type: "before_agent_start",
      prompt: "effective user prompt",
      images: [],
      systemPrompt: "effective system prompt",
      systemPromptOptions: {
        cwd: "/workspace",
        selectedTools,
        toolSnippets,
        promptGuidelines,
        contextFiles,
        skills,
      },
    } as never,
    context as never,
  );
  await handlers.get("context")?.(
    { type: "context", messages: [{ role: "user", content: "effective user prompt" }] } as never,
    context as never,
  );
  await handlers.get("before_provider_request")?.(
    { type: "before_provider_request", payload: { apiKey: "secret", model: "model-1" } } as never,
    context as never,
  );
  await handlers.get("message_end")?.(
    {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Captured output" }],
        api: "openai-responses",
        provider: "acme",
        model: "model-1",
        stopReason: "stop",
        timestamp: Date.now(),
        usage: {
          input: 80,
          output: 12,
          cacheRead: 20,
          cacheWrite: 0,
          reasoning: 4,
          totalTokens: 112,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      },
    } as never,
    context as never,
  );
  trace.observeAgentEvent({ type: "compaction_start", reason: "threshold" } as never);
  await handlers.get("session_before_compact")?.(
    {
      type: "session_before_compact",
      reason: "threshold",
      willRetry: false,
      branchEntries: [{ id: "entry-1" }, { id: "entry-2" }],
      customInstructions: "Keep build diagnostics",
      preparation: {
        firstKeptEntryId: "entry-2",
        messagesToSummarize: [{ role: "user", content: "old question" }],
        turnPrefixMessages: [{ role: "user", content: "current turn" }],
        isSplitTurn: true,
        tokensBefore: 120_000,
        previousSummary: "Earlier summary",
        fileOps: { readFiles: ["README.md"], modifiedFiles: [] },
        settings: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
      },
    } as never,
    context as never,
  );
  await handlers.get("session_compact")?.(
    {
      type: "session_compact",
      reason: "threshold",
      willRetry: false,
      fromExtension: false,
      compactionEntry: { id: "compaction-entry-1" },
    } as never,
    context as never,
  );
  trace.observeAgentEvent({
    type: "compaction_end",
    reason: "threshold",
    aborted: false,
    willRetry: false,
    result: {
      summary: "Compacted build history",
      firstKeptEntryId: "entry-2",
      tokensBefore: 120_000,
      estimatedTokensAfter: 24_000,
      usage: {
        input: 8_000,
        output: 900,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 8_900,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    },
  } as never);

  const snapshot = trace.list(-1, 20);
  const compositionSummary = snapshot.events.find((event) => event.kind === "prompt-composition");
  assert.ok(compositionSummary);
  assert.equal(compositionSummary.promptPreview, "effective user prompt");
  assert.deepEqual(compositionSummary.contextUsage, {
    tokens: 100,
    contextWindow: 128_000,
    percent: 0.078125,
  });
  const composition = await trace.readAny(compositionSummary.traceId);
  assert.equal(composition?.detail.type, "prompt-composition");
  if (composition?.detail.type !== "prompt-composition") assert.fail("Missing composition detail");
  assert.equal(composition.detail.systemPrompt.text, "effective system prompt");
  assert.equal(composition.detail.systemPromptOptions.selectedTools?.length, selectedTools.length);
  assert.equal(
    Object.keys(composition.detail.systemPromptOptions.toolSnippets ?? {}).length,
    Object.keys(toolSnippets).length,
  );
  assert.equal(
    composition.detail.systemPromptOptions.promptGuidelines?.length,
    promptGuidelines.length,
  );
  assert.equal(composition.detail.systemPromptOptions.contextFiles.length, contextFiles.length);
  assert.equal(composition.detail.systemPromptOptions.contextFiles[128]?.content.text, longText);
  assert.equal(composition.detail.systemPromptOptions.skills.length, skills.length);
  assert.equal(composition.detail.systemPromptOptions.skills[128]?.description, longText);
  assert.equal(composition.detail.tools.length, tools.length);
  assert.deepEqual(
    composition.detail.tools.at(-1) && {
      name: composition.detail.tools.at(-1)?.name,
      active: composition.detail.tools.at(-1)?.active,
      description: composition.detail.tools.at(-1)?.description,
      promptGuideline: composition.detail.tools.at(-1)?.promptGuidelines?.[0],
    },
    { name: "tool-512", active: true, description: longText, promptGuideline: longText },
  );

  const providerSummary = snapshot.events.find((event) => event.kind === "provider-request");
  assert.ok(providerSummary);
  const provider = await trace.readAny(providerSummary.traceId);
  if (provider?.detail.type !== "provider-request") assert.fail("Missing provider detail");
  assert.deepEqual(provider.detail.payload.value, {
    apiKey: "secret",
    model: "model-1",
  });
  const outputSummary = snapshot.events.find((event) => event.kind === "model-output");
  assert.ok(outputSummary);
  assert.equal(outputSummary.model?.model, "model-1");
  assert.equal(outputSummary.thinkingLevel, "high");
  assert.deepEqual(outputSummary.usage, {
    input: 80,
    output: 12,
    cacheRead: 20,
    cacheWrite: 0,
    reasoning: 4,
    totalTokens: 112,
  });
  const output = await trace.readAny(outputSummary.traceId);
  assert.equal(output?.detail.type, "model-output");

  const contextSummary = snapshot.events.find((event) => event.kind === "context-snapshot");
  assert.deepEqual(contextSummary?.contextUsage, {
    tokens: 100,
    contextWindow: 128_000,
    percent: 0.078125,
  });
  const contextSnapshot = contextSummary ? await trace.readAny(contextSummary.traceId) : undefined;
  if (contextSnapshot?.detail.type !== "context-snapshot") {
    assert.fail("Missing context snapshot detail");
  }
  assert.deepEqual(contextSnapshot.detail.messageTokenEstimates, {
    method: "pi-estimate-tokens-v1",
    tokens: [6],
  });
  const compactionSummary = snapshot.events.findLast(
    (event) => event.kind === "compaction" && event.compaction?.phase === "end",
  );
  assert.deepEqual(compactionSummary?.compaction, {
    phase: "end",
    reason: "threshold",
    tokensBefore: 120_000,
    estimatedTokensAfter: 24_000,
    firstKeptEntryId: "entry-2",
    summarizedMessageCount: 1,
    turnPrefixMessageCount: 1,
    aborted: false,
    willRetry: false,
  });
  const compaction = compactionSummary ? await trace.readAny(compactionSummary.traceId) : undefined;
  if (compaction?.detail.type !== "compaction") assert.fail("Missing compaction detail");
  assert.equal(compaction.detail.preparation?.customInstructions?.text, "Keep build diagnostics");
  assert.deepEqual(compaction.detail.preparation?.messagesToSummarize.value, [
    { role: "user", content: "old question" },
  ]);
  assert.equal(compaction.detail.result?.summary.text, "Compacted build history");
  assert.equal(compaction.detail.result?.compactionEntryId, "compaction-entry-1");
  assert.equal(compaction.detail.result?.fromExtension, false);

  await releaseSessionContextTrace("session-1", trace);
  const persisted = await SessionContextTraceJournal.readActivation(
    "session-1",
    trace.activationId,
    -1,
    100,
  );
  assert.deepEqual(
    persisted.events.map((event) => event.kind),
    snapshot.events.map((event) => event.kind),
  );
  assert.equal(
    persisted.events.find((event) => event.kind === "prompt-composition")?.promptPreview,
    "effective user prompt",
  );
  const persistedProvider = await SessionContextTraceJournal.readEvent(
    "session-1",
    providerSummary.traceId,
  );
  if (persistedProvider?.detail.type !== "provider-request") {
    assert.fail("Missing persisted provider detail");
  }
  assert.deepEqual(persistedProvider.detail.payload.value, {
    apiKey: "secret",
    model: "model-1",
  });
  const persistedContext = contextSummary
    ? await SessionContextTraceJournal.readEvent("session-1", contextSummary.traceId)
    : undefined;
  if (persistedContext?.detail.type !== "context-snapshot") {
    assert.fail("Missing persisted context snapshot");
  }
  assert.deepEqual(persistedContext.detail.messageTokenEstimates, {
    method: "pi-estimate-tokens-v1",
    tokens: [6],
  });
  const persistedCompaction = compactionSummary
    ? await SessionContextTraceJournal.readEvent("session-1", compactionSummary.traceId)
    : undefined;
  if (persistedCompaction?.detail.type !== "compaction") {
    assert.fail("Missing persisted compaction detail");
  }
  assert.equal(persistedCompaction.detail.result?.summary.text, "Compacted build history");
  assert.deepEqual(persistedCompaction.detail.preparation?.turnPrefixMessages.value, [
    { role: "user", content: "current turn" },
  ]);
});
