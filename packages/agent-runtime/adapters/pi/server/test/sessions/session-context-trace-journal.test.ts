import assert from "node:assert/strict";
import { appendFile, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerHooks } from "node:module";
import test from "node:test";

import type { SessionContextTraceEvent } from "@workbench/agent-runtime-pi-protocol/rpc";

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

const { SessionContextTraceJournal, SessionContextTraceJournalError } = (await import(
  new URL("../../src/sessions/session-context-trace-journal.ts", import.meta.url).href
)) as typeof import("../../src/sessions/session-context-trace-journal");
const {
  captureSessionContextTraceJson,
  captureSessionContextTraceText,
  readSessionContextTracePromptParts,
  SessionContextTrace,
  SESSION_CONTEXT_TRACE_MAX_EVENTS,
} = (await import(
  new URL("../../src/sessions/session-context-trace.ts", import.meta.url).href
)) as typeof import("../../src/sessions/session-context-trace");

test.after(() => moduleHooks.deregister());

function roundStartEvent(): SessionContextTraceEvent {
  return {
    schemaVersion: 1,
    traceId: "activation-a:0",
    sessionId: "session-a",
    activationId: "activation-a",
    seq: 0,
    time: Date.now(),
    kind: "round-start",
    detailBytes: 32,
    truncated: false,
    redacted: false,
    detail: { type: "round-start", trigger: "prompt" },
  };
}

function turnEndEvent(): SessionContextTraceEvent {
  const capture = {
    value: [],
    capture: {
      originalBytes: 2,
      capturedBytes: 2,
      truncated: false,
      redactedPaths: [],
    },
  };
  return {
    schemaVersion: 1,
    traceId: "activation-a:1",
    sessionId: "session-a",
    activationId: "activation-a",
    seq: 1,
    time: Date.now(),
    kind: "turn-end",
    detailBytes: 128,
    truncated: false,
    redacted: false,
    detail: {
      type: "turn-end",
      message: capture,
      toolResultCount: 0,
      toolResults: capture,
      usage: {
        input: 100,
        output: 25,
        cacheRead: 800,
        cacheWrite: 75,
        totalTokens: 1_000,
      },
    },
  };
}

function promptCompositionEvent(
  sessionId: string,
  activationId: string,
  roundId: string,
): SessionContextTraceEvent {
  return {
    schemaVersion: 1,
    traceId: `${activationId}:0`,
    sessionId,
    activationId,
    seq: 0,
    time: 1_000,
    kind: "prompt-composition",
    detailBytes: 128,
    truncated: false,
    redacted: false,
    roundId,
    detail: {
      type: "prompt-composition",
      prompt: captureSessionContextTraceText("Persist this prompt composition"),
      systemPrompt: captureSessionContextTraceText("system"),
      systemPromptSources: [
        {
          kind: "replacement",
          scope: "user",
          path: "/agent/SYSTEM.md",
          content: captureSessionContextTraceText("user system prompt"),
        },
      ],
      systemPromptOptions: {
        cwd: "/workspace",
        contextFiles: [
          {
            path: "/workspace/AGENTS.md",
            content: captureSessionContextTraceText("project instructions"),
          },
        ],
        skills: [],
      },
      images: captureSessionContextTraceJson([]),
      tools: [],
    },
  };
}

function modelOutputEvent(
  sessionId: string,
  activationId: string,
  roundId: string,
  timestamp: number,
): SessionContextTraceEvent {
  return {
    schemaVersion: 1,
    traceId: `${activationId}:1`,
    sessionId,
    activationId,
    seq: 1,
    time: 2_000,
    kind: "model-output",
    detailBytes: 128,
    truncated: false,
    redacted: false,
    roundId,
    detail: {
      type: "model-output",
      message: captureSessionContextTraceJson({
        role: "assistant",
        content: [{ type: "text", text: "Done" }],
        timestamp,
      }),
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
      },
    },
  };
}

test("persists private hash-chained activation journals and detects tampering", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-context-trace-journal-"));
  const previousRoot = process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR;
  process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR = root;
  t.after(async () => {
    if (previousRoot === undefined) delete process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR;
    else process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR = previousRoot;
    await rm(root, { recursive: true, force: true });
  });

  const journal = await SessionContextTraceJournal.create("session-a", "activation-a");
  journal.append(roundStartEvent());
  journal.append(turnEndEvent());
  await journal.flush();

  const active = await SessionContextTraceJournal.listActivations("session-a", "activation-a");
  assert.equal(active.length, 1);
  assert.equal(active[0]?.eventCount, 2);
  assert.equal(active[0]?.active, true);
  assert.equal(active[0]?.complete, false);

  const page = await SessionContextTraceJournal.readActivation(
    "session-a",
    "activation-a",
    -1,
    100,
  );
  assert.deepEqual(
    page.events.map((event) => event.traceId),
    ["activation-a:0", "activation-a:1"],
  );
  assert.deepEqual(page.events[1]?.usage, {
    input: 100,
    output: 25,
    cacheRead: 800,
    cacheWrite: 75,
    totalTokens: 1_000,
  });
  assert.equal(page.hasMore, false);
  assert.equal(
    (await SessionContextTraceJournal.readEvent("session-a", "activation-a:0"))?.detail.type,
    "round-start",
  );
  const persistedTurn = await SessionContextTraceJournal.readEvent("session-a", "activation-a:1");
  assert.equal(persistedTurn?.detail.type, "turn-end");
  if (persistedTurn?.detail.type !== "turn-end") assert.fail("Missing persisted turn-end");
  assert.equal(persistedTurn.detail.usage?.cacheRead, 800);

  await Promise.all([journal.close(), journal.close()]);
  const completed = await SessionContextTraceJournal.listActivations("session-a");
  assert.equal(completed[0]?.complete, true);

  const [sessionDirectoryName] = await readdir(root);
  assert.ok(sessionDirectoryName);
  const sessionDirectory = path.join(root, sessionDirectoryName);
  const journalFile = path.join(sessionDirectory, "activation-a.jsonl");
  assert.equal((await stat(root)).mode & 0o777, 0o700);
  assert.equal((await stat(sessionDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(journalFile)).mode & 0o777, 0o600);

  await appendFile(journalFile, '{"tampered":true}\n', "utf8");
  await assert.rejects(
    SessionContextTraceJournal.readActivation("session-a", "activation-a", -1, 100),
    (error: unknown) =>
      error instanceof SessionContextTraceJournalError &&
      error.code === "context-trace-journal-corrupt",
  );
});

test("reports a stable not-found code for a missing activation", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-context-trace-missing-"));
  const previousRoot = process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR;
  process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR = root;
  t.after(async () => {
    if (previousRoot === undefined) delete process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR;
    else process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR = previousRoot;
    await rm(root, { recursive: true, force: true });
  });

  await assert.rejects(
    SessionContextTraceJournal.readActivation("session-a", "missing-activation", -1, 100),
    (error: unknown) =>
      error instanceof SessionContextTraceJournalError && error.code === "context-trace-not-found",
  );
});

test("replays only durable prompt-composition Parts without starting a live trace", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-context-trace-prompt-parts-"));
  const previousRoot = process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR;
  process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR = root;
  t.after(async () => {
    if (previousRoot === undefined) delete process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR;
    else process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR = previousRoot;
    await rm(root, { recursive: true, force: true });
  });

  const sessionId = "session-prompt-parts";
  const activationId = "activation-prompt-parts";
  const roundId = "round-prompt-parts";
  const journal = await SessionContextTraceJournal.create(sessionId, activationId);
  journal.append(promptCompositionEvent(sessionId, activationId, roundId));
  journal.append(modelOutputEvent(sessionId, activationId, roundId, 42_000));
  await journal.close();

  const value = await readSessionContextTracePromptParts(sessionId);

  assert.equal(value.source, "disk");
  assert.equal(value.integrity, "verified");
  assert.equal(value.parts.length, 1);
  assert.equal(value.parts[0]?.event.kind, "prompt-composition");
  assert.equal(value.parts[0]?.event.promptPreview, "Persist this prompt composition");
  assert.deepEqual(value.parts[0]?.event.promptResources?.systemPromptSources, [
    { kind: "replacement", scope: "user", path: "/agent/SYSTEM.md" },
  ]);
  assert.deepEqual(value.parts[0]?.event.promptResources?.contextFiles, ["/workspace/AGENTS.md"]);
  assert.equal(value.parts[0]?.assistantMessageTimestamp, 42_000);
});

test("rebuilds current activation prompt previews from one journal list page", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-context-trace-summary-page-"));
  const previousRoot = process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR;
  process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR = root;
  const journal = await SessionContextTraceJournal.create("session-b", "activation-b");
  const trace = new SessionContextTrace("session-b", undefined, journal);
  t.after(async () => {
    await trace.close();
    if (previousRoot === undefined) delete process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR;
    else process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR = previousRoot;
    await rm(root, { recursive: true, force: true });
  });

  trace.observePromptComposition({
    type: "prompt-composition",
    prompt: captureSessionContextTraceText("请检查项目为什么构建失败"),
    systemPrompt: captureSessionContextTraceText("system"),
    systemPromptOptions: { cwd: "/workspace", contextFiles: [], skills: [] },
    images: captureSessionContextTraceJson([]),
    tools: [],
  });

  const legacyPrompt = trace
    .list(-1, 100)
    .events.find((event) => event.kind === "prompt-composition");
  assert.ok(legacyPrompt);
  delete legacyPrompt.promptPreview;

  const legacyPage = await trace.listActivation(undefined, -1, 100);
  assert.equal(legacyPage.source, "disk");
  assert.equal(
    legacyPage.events.find((event) => event.kind === "prompt-composition")?.promptPreview,
    "请检查项目为什么构建失败",
  );

  for (let index = 0; index < SESSION_CONTEXT_TRACE_MAX_EVENTS + 10; index += 1) {
    trace.observeContext([{ index }]);
  }
  assert.ok(trace.list(-1, 100).retainedFromSeq > 0);

  const restoredPage = await trace.listActivation(trace.activationId, -1, 500);
  assert.equal(restoredPage.source, "disk");
  assert.equal(restoredPage.integrity, "verified");
  assert.equal(restoredPage.events[0]?.seq, 0);
  assert.equal(
    restoredPage.events.find((event) => event.kind === "prompt-composition")?.promptPreview,
    "请检查项目为什么构建失败",
  );
});
