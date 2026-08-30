import assert from "node:assert/strict";
import { registerHooks } from "node:module";
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

const {
  captureSessionContextTraceJson,
  captureSessionContextTraceHeaders,
  captureSessionContextTraceText,
  sessionContextTraceExtensions,
  sessionContextTraceSystemPromptSources,
  SessionContextTrace,
  SESSION_CONTEXT_TRACE_MAX_EVENTS,
} = (await import(
  new URL("../../src/sessions/session-context-trace.ts", import.meta.url).href
)) as typeof import("../../src/sessions/session-context-trace");
const { sessionContextTracePromptPreview } = (await import(
  new URL("../../src/sessions/session-context-trace-summary.ts", import.meta.url).href
)) as typeof import("../../src/sessions/session-context-trace-summary");

test.after(() => moduleHooks.deregister());

test("projects Pi system prompt precedence without mixing in Skills", () => {
  const sources = sessionContextTraceSystemPromptSources(
    {
      getSystemPrompt: () => "Project system prompt",
      getSystemPromptSource: () => ({ path: "/workspace/.pi/SYSTEM.md" }),
      getAppendSystemPrompt: () => ["User append prompt"],
      getAppendSystemPromptSources: () => [{ path: "/agent/APPEND_SYSTEM.md" }],
    } as never,
    "/workspace",
    "/agent",
  );

  assert.deepEqual(
    sources.map(({ kind, scope, path: sourcePath, content }) => ({
      kind,
      scope,
      path: sourcePath,
      content: content?.text,
    })),
    [
      {
        kind: "replacement",
        scope: "project",
        path: "/workspace/.pi/SYSTEM.md",
        content: "Project system prompt",
      },
      {
        kind: "append",
        scope: "user",
        path: "/agent/APPEND_SYSTEM.md",
        content: "User append prompt",
      },
    ],
  );
  assert.deepEqual(
    sessionContextTraceSystemPromptSources(
      {
        getSystemPrompt: () => undefined,
        getSystemPromptSource: () => undefined,
        getAppendSystemPrompt: () => [],
        getAppendSystemPromptSources: () => [],
      } as never,
      "/workspace",
      "/agent",
    ),
    [{ kind: "builtin", scope: "builtin" }],
  );
});

test("projects the final Pi extension inventory without retaining runtime handlers", () => {
  const extensions = sessionContextTraceExtensions({
    getExtensions: () => ({
      extensions: [
        {
          path: "<inline:workbench.context-trace>",
          resolvedPath: "<inline:workbench.context-trace>",
          hidden: true,
          sourceInfo: {
            path: "<inline:workbench.context-trace>",
            source: "inline",
            scope: "temporary",
            origin: "top-level",
          },
          handlers: new Map(),
          tools: new Map(),
          messageRenderers: new Map(),
          commands: new Map(),
          flags: new Map(),
          shortcuts: new Map(),
        },
        {
          path: "/workspace/.pi/extensions/audit.ts",
          resolvedPath: "/workspace/.pi/extensions/audit.ts",
          sourceInfo: {
            path: "/workspace/.pi/extensions/audit.ts",
            source: "project",
            scope: "project",
            origin: "top-level",
          },
          handlers: new Map(),
          tools: new Map(),
          messageRenderers: new Map(),
          commands: new Map(),
          flags: new Map(),
          shortcuts: new Map(),
        },
      ],
      errors: [],
      runtime: {},
    }),
  } as never);

  assert.deepEqual(
    extensions.map(({ name, hidden, source }) => ({ name, hidden, scope: source.scope })),
    [
      { name: "workbench.context-trace", hidden: true, scope: "temporary" },
      { name: "audit", hidden: false, scope: "project" },
    ],
  );
});

test("copies the final prompt resource inventory onto the live event summary", () => {
  const trace = new SessionContextTrace("session-resources");
  trace.observePromptComposition({
    type: "prompt-composition",
    prompt: captureSessionContextTraceText("hello"),
    systemPrompt: captureSessionContextTraceText("system prompt"),
    systemPromptSources: [
      {
        kind: "replacement",
        scope: "user",
        path: "/agent/SYSTEM.md",
        content: captureSessionContextTraceText("user system prompt"),
      },
      {
        kind: "append",
        scope: "project",
        path: "/workspace/.pi/APPEND_SYSTEM.md",
        content: captureSessionContextTraceText("project append prompt"),
      },
      {
        kind: "extension",
        scope: "project",
        path: "/workspace/.pi/extensions/audit.ts",
        hook: "before_agent_start",
        handlerIndex: 1,
        content: captureSessionContextTraceText("system prompt after extension hook"),
      },
    ],
    systemPromptOptions: {
      cwd: "/workspace",
      contextFiles: [{ path: "AGENTS.md", content: captureSessionContextTraceText("rules") }],
      skills: [
        {
          name: "review",
          filePath: "/workspace/.pi/skills/review/SKILL.md",
          disableModelInvocation: false,
        },
      ],
    },
    images: captureSessionContextTraceJson([]),
    tools: [
      {
        name: "read",
        description: "Read a file",
        active: true,
        source: {
          path: "<builtin:read>",
          source: "builtin",
          scope: "temporary",
          origin: "top-level",
        },
        parameters: captureSessionContextTraceJson({}),
      },
    ],
    extensions: [
      {
        name: "audit",
        path: "/workspace/.pi/extensions/audit.ts",
        resolvedPath: "/workspace/.pi/extensions/audit.ts",
        hidden: false,
        source: {
          path: "/workspace/.pi/extensions/audit.ts",
          source: "project",
          scope: "project",
          origin: "top-level",
        },
      },
    ],
  });

  const summary = trace.list(-1, 10).events.find((event) => event.kind === "prompt-composition");
  assert.deepEqual(summary?.promptResources, {
    systemPromptCharacters: 13,
    systemPromptSourceCount: 3,
    systemPromptSources: [
      { kind: "replacement", scope: "user", path: "/agent/SYSTEM.md" },
      {
        kind: "append",
        scope: "project",
        path: "/workspace/.pi/APPEND_SYSTEM.md",
      },
      {
        kind: "extension",
        scope: "project",
        path: "/workspace/.pi/extensions/audit.ts",
        hook: "before_agent_start",
        handlerIndex: 1,
      },
    ],
    contextFileCount: 1,
    contextFiles: ["AGENTS.md"],
    skills: [{ name: "review", disableModelInvocation: false }],
    extensions: [{ name: "audit", hidden: false }],
    tools: { active: ["read"], total: 1 },
  });
});

test("preserves complete serializable values, sensitive fields, binary bodies, and headers", () => {
  const longText = "x".repeat(140 * 1024);
  const manyItems = Array.from({ length: 300 }, (_, index) => ({ index }));
  const capture = captureSessionContextTraceJson({
    authorization: "Bearer secret",
    apiKey: "secret-key",
    body: {
      type: "image",
      mediaType: "image/png",
      data: "aGVsbG8=",
      caption: "diagram",
    },
    longText,
    manyItems,
  });
  const value = capture.value as Record<string, unknown>;
  const body = value.body as Record<string, unknown>;

  assert.equal(value.authorization, "Bearer secret");
  assert.equal(value.apiKey, "secret-key");
  assert.equal(body.data, "aGVsbG8=");
  assert.equal(body.caption, "diagram");
  assert.equal(value.longText, longText);
  assert.deepEqual(value.manyItems, manyItems);
  assert.equal(capture.capture.truncated, false);
  assert.deepEqual(capture.capture.redactedPaths, []);
  assert.deepEqual(
    captureSessionContextTraceHeaders({
      "content-type": "text/event-stream",
      "x-request-id": "request-1",
      "set-cookie": "secret",
      authorization: "Bearer secret",
    }),
    {
      "content-type": "text/event-stream",
      "x-request-id": "request-1",
      "set-cookie": "secret",
      authorization: "Bearer secret",
    },
  );
  const textCapture = captureSessionContextTraceText(longText);
  assert.equal(textCapture.text, longText);
  assert.equal(textCapture.capturedBytes, textCapture.originalBytes);
  assert.equal(textCapture.truncated, false);
});

test("builds a bounded user-question preview without injected context wrappers", () => {
  assert.equal(
    sessionContextTracePromptPreview(
      "<workbench-untrusted-context>attachment metadata</workbench-untrusted-context> " +
        "<user-request>请帮我检查这个项目为什么构建失败，并给出修复建议</user-request>",
    ),
    "请帮我检查这个项目为什么构建失败，并给出修复建议",
  );
  assert.equal(
    sessionContextTracePromptPreview("abcdefghijklmnopqrstuvwxyz1234567890"),
    "abcdefghijklmnopqrstuvwxyz123456…",
  );
});

test("preserves event details larger than the legacy per-event limit", () => {
  const trace = new SessionContextTrace("session-large-detail");
  const content = "x".repeat(4 * 1024 * 1024 + 1);

  trace.observeProviderRequest({ authorization: "Bearer secret", content });

  const summary = trace.list(-1, 10).events.find((event) => event.kind === "provider-request");
  assert.ok(summary);
  assert.equal(summary.truncated, false);
  assert.equal(summary.redacted, false);
  const detail = trace.read(summary.traceId);
  if (detail?.detail.type !== "provider-request") assert.fail("Missing provider detail");
  const payload = detail.detail.payload.value as Record<string, unknown>;
  assert.equal(payload.authorization, "Bearer secret");
  assert.equal(payload.content, content);
});

test("correlates round, retry run, turn, and logical provider request coordinates", () => {
  const published: unknown[] = [];
  const trace = new SessionContextTrace("session-1", (event) => published.push(event));

  trace.observePromptComposition({
    type: "prompt-composition",
    prompt: captureSessionContextTraceText("hello"),
    systemPrompt: captureSessionContextTraceText("system"),
    systemPromptOptions: { cwd: "/workspace", contextFiles: [], skills: [] },
    images: captureSessionContextTraceJson([]),
    tools: [],
  });
  trace.observeAgentEvent({ type: "agent_start" } as never);
  trace.observeAgentEvent({ type: "turn_start" } as never);
  trace.observeContext([{ role: "user", content: "hello" }]);
  trace.observeProviderRequest({ model: "model-1", messages: [] });
  trace.observeProviderResponse(200, { "x-request-id": "provider-request-1" });
  const assistantMessage = {
    role: "assistant",
    content: [{ type: "toolCall", id: "tool-call-1", name: "read", arguments: {} }],
    api: "openai-responses",
    provider: "acme",
    model: "model-1",
    stopReason: "toolUse",
    timestamp: Date.now(),
    usage: {
      input: 120,
      output: 30,
      cacheRead: 900,
      cacheWrite: 50,
      cacheWrite1h: 20,
      reasoning: 12,
      totalTokens: 1_100,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  } as const;
  trace.observeModelOutput(
    assistantMessage as never,
    { provider: "acme", model: "model-1", api: "openai-responses" },
    "high",
  );
  trace.observeAgentEvent({
    type: "tool_execution_start",
    toolCallId: "tool-call-1",
    toolName: "read",
    args: { path: "/workspace/README.md" },
  } as never);
  trace.observeAgentEvent({
    type: "tool_execution_end",
    toolCallId: "tool-call-1",
    toolName: "read",
    result: { content: "README" },
    isError: false,
  } as never);
  trace.observeAgentEvent({
    type: "turn_end",
    message: assistantMessage,
    toolResults: [],
  } as never);
  trace.observeAgentEvent({ type: "agent_end", messages: [], willRetry: true } as never);
  trace.observeAgentEvent({
    type: "auto_retry_start",
    attempt: 1,
    maxAttempts: 3,
    delayMs: 100,
    errorMessage: "temporary failure",
  } as never);
  trace.observeAgentEvent({ type: "agent_start" } as never);
  trace.observeAgentEvent({ type: "turn_start" } as never);
  trace.observeAgentEvent({ type: "agent_end", messages: [], willRetry: false } as never);
  trace.observeAgentEvent({ type: "agent_settled" } as never);

  const snapshot = trace.list(-1, 100);
  assert.equal(
    snapshot.events.find((event) => event.kind === "prompt-composition")?.promptPreview,
    "hello",
  );
  assert.deepEqual(
    snapshot.events.map((event) => event.kind),
    [
      "round-start",
      "prompt-composition",
      "run-start",
      "turn-start",
      "context-snapshot",
      "provider-request",
      "provider-response",
      "model-output",
      "tool-execution-start",
      "tool-execution-end",
      "turn-end",
      "run-end",
      "retry",
      "run-start",
      "turn-start",
      "run-end",
      "round-settled",
    ],
  );
  assert.ok(published.every((event) => !("detail" in (event as object))));

  const roundIds = new Set(snapshot.events.map((event) => event.roundId));
  assert.equal(roundIds.size, 1);
  const runs = snapshot.events.filter((event) => event.kind === "run-start");
  assert.deepEqual(
    runs.map((event) => event.runIndex),
    [0, 1],
  );
  const turns = snapshot.events.filter((event) => event.kind === "turn-start");
  assert.deepEqual(
    turns.map((event) => event.turnIndex),
    [0, 0],
  );

  const request = snapshot.events.find((event) => event.kind === "provider-request");
  const response = snapshot.events.find((event) => event.kind === "provider-response");
  assert.ok(request?.requestId);
  const contextSnapshotSummary = snapshot.events.find((event) => event.kind === "context-snapshot");
  const contextSnapshot = contextSnapshotSummary
    ? trace.read(contextSnapshotSummary.traceId)
    : undefined;
  if (contextSnapshot?.detail.type !== "context-snapshot") {
    assert.fail("Missing context snapshot");
  }
  assert.deepEqual(contextSnapshot.detail.messageTokenEstimates, {
    method: "pi-estimate-tokens-v1",
    tokens: [2],
  });
  assert.equal(response?.requestId, request.requestId);
  assert.equal(response?.requestIndex, request.requestIndex);
  const toolStart = snapshot.events.find((event) => event.kind === "tool-execution-start");
  const toolEnd = snapshot.events.find((event) => event.kind === "tool-execution-end");
  assert.equal(toolStart?.toolCallId, "tool-call-1");
  assert.equal(toolStart?.toolName, "read");
  assert.equal(toolEnd?.toolCallId, toolStart?.toolCallId);
  assert.equal(toolEnd?.turnId, toolStart?.turnId);
  const toolStartDetail = toolStart ? trace.read(toolStart.traceId) : undefined;
  const toolEndDetail = toolEnd ? trace.read(toolEnd.traceId) : undefined;
  assert.equal(toolStartDetail?.detail.type, "tool-execution-start");
  assert.equal(toolEndDetail?.detail.type, "tool-execution-end");
  const turnEnd = snapshot.events.find((event) => event.kind === "turn-end");
  const expectedUsage = {
    input: 120,
    output: 30,
    cacheRead: 900,
    cacheWrite: 50,
    cacheWrite1h: 20,
    reasoning: 12,
    totalTokens: 1_100,
  };
  assert.deepEqual(turnEnd?.usage, expectedUsage);
  const modelOutput = snapshot.events.find((event) => event.kind === "model-output");
  assert.deepEqual(modelOutput?.usage, expectedUsage);
  assert.deepEqual(modelOutput?.model, {
    provider: "acme",
    model: "model-1",
    api: "openai-responses",
  });
  assert.equal(modelOutput?.thinkingLevel, "high");
  const modelOutputDetail = modelOutput ? trace.read(modelOutput.traceId) : undefined;
  assert.equal(modelOutputDetail?.detail.type, "model-output");
  const turnEndDetail = turnEnd ? trace.read(turnEnd.traceId) : undefined;
  assert.equal(turnEndDetail?.detail.type, "turn-end");
  if (turnEndDetail?.detail.type !== "turn-end") assert.fail("Missing turn-end detail");
  assert.deepEqual(turnEndDetail.detail.usage, expectedUsage);
  assert.ok(
    snapshot.events.filter((event) => event.kind === "run-end").every((event) => !event.turnId),
  );
  assert.equal(trace.read(request.traceId)?.detail.type, "provider-request");
  assert.deepEqual(
    trace.list(request.seq, 2).events.map((event) => event.kind),
    ["provider-response", "model-output"],
  );
});

test("evicts old trace details at the bounded event limit", () => {
  const trace = new SessionContextTrace("session-1");
  for (let index = 0; index < SESSION_CONTEXT_TRACE_MAX_EVENTS + 25; index += 1) {
    trace.observeContext([{ index }]);
  }

  const snapshot = trace.list(-1, 10_000);
  assert.equal(snapshot.events.length, SESSION_CONTEXT_TRACE_MAX_EVENTS);
  assert.ok(snapshot.retainedFromSeq > 0);
  assert.equal(snapshot.nextSeq, SESSION_CONTEXT_TRACE_MAX_EVENTS + 26);
  assert.equal(trace.read(`${snapshot.activationId}:0`), undefined);
});
