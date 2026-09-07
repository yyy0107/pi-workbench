import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BUILTIN_EXTENSION_PREFERENCE_KEYS,
} from "@workbench/agent-runtime-contracts/settings";
import { WorkbenchSettingsService } from "@workbench/settings-server/service";
import {
  bindPiAgentHostBindings,
  getPiAgentHostBindings,
} from "../../src/agent-runtime/pi-agent-host-bindings";

const { contextTraceExtension } = await import("../../src/internal-extensions/context-trace");
const { prepareWorkbenchPiExtensions } = await import("../../src/internal-extensions/index");
const { activateSessionContextTrace, releaseSessionContextTrace } =
  await import("../../src/sessions/session-context-trace");

test("records every effective before_agent_start system-prompt mutation in execution order", async (t) => {
  const traceDirectory = await mkdtemp(path.join(tmpdir(), "workbench-system-prompt-hook-trace-"));
  const previousTraceDirectory = process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR;
  let activeTrace: Awaited<ReturnType<typeof activateSessionContextTrace>> | undefined;
  process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR = traceDirectory;
  t.after(async () => {
    if (activeTrace) await releaseSessionContextTrace("session-hook-trace", activeTrace);
    if (previousTraceDirectory === undefined) delete process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR;
    else process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR = previousTraceDirectory;
    await rm(traceDirectory, { recursive: true, force: true });
  });

  type TestHandler = (...args: unknown[]) => Promise<unknown>;
  const extensionHandlers: TestHandler[] = [
    async (event: unknown) => ({
      systemPrompt: `${(event as { systemPrompt: string }).systemPrompt}\nfirst injection`,
    }),
    async (event: unknown) => ({
      systemPrompt: (event as { systemPrompt: string }).systemPrompt,
    }),
    async (event: unknown) => ({
      systemPrompt: `${(event as { systemPrompt: string }).systemPrompt}\nsecond injection`,
    }),
  ];
  const result = {
    extensions: [
      {
        path: "/workspace/.pi/extensions/prompt-injector.ts",
        resolvedPath: "/workspace/.pi/extensions/prompt-injector.ts",
        sourceInfo: {
          path: "/workspace/.pi/extensions/prompt-injector.ts",
          source: "project",
          scope: "project",
          origin: "top-level",
        },
        handlers: new Map([["before_agent_start", extensionHandlers]]),
        tools: new Map(),
        messageRenderers: new Map(),
        commands: new Map(),
        flags: new Map(),
        shortcuts: new Map(),
      },
    ],
    errors: [],
    runtime: {},
  };
  prepareWorkbenchPiExtensions(result as never);
  const wrappedHandlers = result.extensions[0].handlers.get("before_agent_start");
  assert.ok(wrappedHandlers);
  prepareWorkbenchPiExtensions(result as never);
  assert.equal(result.extensions[0].handlers.get("before_agent_start")?.[0], wrappedHandlers[0]);

  const trace = (activeTrace = await activateSessionContextTrace("session-hook-trace"));
  trace.setSystemPromptSourcesResolver(() => [{ kind: "builtin", scope: "builtin" }]);

  let systemPrompt = "base prompt";
  const context = {
    cwd: "/workspace",
    sessionManager: { getSessionId: () => "session-hook-trace" },
    getSystemPrompt: () => systemPrompt,
    getContextUsage: () => undefined,
  };
  for (const handler of wrappedHandlers) {
    const hookResult = (await handler(
      {
        type: "before_agent_start",
        prompt: "hello",
        systemPrompt,
        systemPromptOptions: { cwd: "/workspace", contextFiles: [], skills: [] },
      },
      context,
    )) as { systemPrompt?: string } | undefined;
    if (hookResult?.systemPrompt !== undefined) systemPrompt = hookResult.systemPrompt;
  }

  const traceHandlers = new Map<string, (event: never, context: never) => unknown>();
  contextTraceExtension({
    on(event: string, handler: (event: never, context: never) => unknown) {
      traceHandlers.set(event, handler);
    },
    getActiveTools: () => [],
    getAllTools: () => [],
  } as never);
  await traceHandlers.get("before_agent_start")?.(
    {
      type: "before_agent_start",
      prompt: "hello",
      images: [],
      systemPrompt,
      systemPromptOptions: { cwd: "/workspace", contextFiles: [], skills: [] },
    } as never,
    context as never,
  );
  await traceHandlers.get("context")?.(
    { type: "context", messages: [{ role: "user", content: "hello" }] } as never,
    context as never,
  );
  const summary = trace.list(-1, 10).events.find((event) => event.kind === "prompt-composition");
  assert.ok(summary);
  assert.deepEqual(summary.promptResources?.systemPromptSources, [
    { kind: "builtin", scope: "builtin" },
    {
      kind: "extension",
      scope: "project",
      path: "/workspace/.pi/extensions/prompt-injector.ts",
      hook: "before_agent_start",
      handlerIndex: 0,
    },
    {
      kind: "extension",
      scope: "project",
      path: "/workspace/.pi/extensions/prompt-injector.ts",
      hook: "before_agent_start",
      handlerIndex: 2,
    },
  ]);

  const detail = await trace.readAny(summary.traceId);
  if (detail?.detail.type !== "prompt-composition") assert.fail("Missing prompt composition");
  assert.equal(detail.detail.systemPrompt.text, "base prompt\nfirst injection\nsecond injection");
  assert.deepEqual(
    detail.detail.systemPromptSources?.map((source) => ({
      kind: source.kind,
      path: source.path,
      hook: source.hook,
      handlerIndex: source.handlerIndex,
      content: source.content?.text,
    })),
    [
      {
        kind: "builtin",
        path: undefined,
        hook: undefined,
        handlerIndex: undefined,
        content: undefined,
      },
      {
        kind: "extension",
        path: "/workspace/.pi/extensions/prompt-injector.ts",
        hook: "before_agent_start",
        handlerIndex: 0,
        content: "base prompt\nfirst injection",
      },
      {
        kind: "extension",
        path: "/workspace/.pi/extensions/prompt-injector.ts",
        hook: "before_agent_start",
        handlerIndex: 2,
        content: "base prompt\nfirst injection\nsecond injection",
      },
    ],
  );
});

test("all builtin lifecycle extensions switch live without losing their catalog or persisted state", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "builtin-resource-switches-"));
  const previous = getPiAgentHostBindings();
  t.after(async () => {
    bindPiAgentHostBindings(previous);
    await rm(root, { recursive: true, force: true });
  });
  const stateFile = path.join(root, "settings.json");
  const settings = new WorkbenchSettingsService({ stateFile });
  bindPiAgentHostBindings({
    readBuiltinResourceEnabled: async (key) =>
      (await new WorkbenchSettingsService({ stateFile }).describe()).preferences[key] !== false,
  });
  for (const [name, key] of Object.entries(BUILTIN_EXTENSION_PREFERENCE_KEYS)) {
    let calls = 0;
    const result = {
      extensions: [
        {
          path: `<inline:${name}>`,
          tools: new Map(),
          handlers: new Map([["context", [async () => ++calls]]]),
        },
      ],
      errors: [],
      runtime: {},
    };
    prepareWorkbenchPiExtensions(result as never);
    const handler = result.extensions[0].handlers.get("context")![0];
    assert.equal(await handler(), 1);
    await settings.update({ patch: { [key]: false } });
    assert.equal(await handler(), undefined);
    assert.equal(calls, 1);
    assert.equal(result.extensions.length, 1);
    assert.equal(result.extensions[0].handlers.get("context")?.length, 1);
    await settings.update({ patch: { [key]: true } });
    assert.equal(await handler(), 2);
  }
  for (const key of [
    ...Object.values(BUILTIN_EXTENSION_PREFERENCE_KEYS),
  ]) {
    await settings.update({ patch: { [key]: false } });
    assert.equal(
      (await new WorkbenchSettingsService({ stateFile }).describe()).preferences[key],
      false,
    );
    await assert.rejects(settings.update({ patch: { [key]: "false" } as never }), {
      code: "workbench-settings-invalid",
    });
  }
});
