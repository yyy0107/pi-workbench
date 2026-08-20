import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import type { MuxStreamPayload, ServerRequest } from "../../stream-contracts";

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
  createDetachedSessionFork,
  getSessionEvents,
  listSessions,
  messagesHaveImages,
  renameSession,
  SerializedSessionMutations,
  sessionModifiedAt,
} = (await import(
  new URL("./session-registry.ts", import.meta.url).href
)) as typeof import("./session-registry");
const { appendSessionEventJournal } = (await import(
  new URL("./session-event-journal.ts", import.meta.url).href
)) as typeof import("./session-event-journal");
const { createStreamHub, STREAM_HUB_SYMBOL } = (await import(
  new URL("../streams/stream-hub.ts", import.meta.url).href
)) as typeof import("../streams/stream-hub");
moduleHooks.deregister();

test("detects image content across durable session message roles", () => {
  assert.equal(messagesHaveImages([{ role: "user", content: "text only" }]), false);
  assert.equal(
    messagesHaveImages([
      {
        role: "toolResult",
        content: [
          { type: "text", text: "preview" },
          { type: "image", mimeType: "image/png", data: "image-data" },
        ],
      },
    ]),
    true,
  );
});

test("serializes prompt, queue, and model mutation admission through one tail", async () => {
  const mutations = new SerializedSessionMutations();
  const entered: string[] = [];
  let releaseFirst!: () => void;
  const first = mutations.run(async () => {
    entered.push("prompt");
    await new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
  });
  const second = mutations.run(async () => {
    entered.push("select-model");
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(entered, ["prompt"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(entered, ["prompt", "select-model"]);
});

test("derives a live host timestamp from persisted branch metadata", () => {
  const modified = sessionModifiedAt({
    getBranch: () => [
      { timestamp: "2026-01-01T00:00:00.000Z" },
      { timestamp: "2026-02-03T04:05:06.000Z" },
      { timestamp: "not-a-timestamp" },
    ],
    getHeader: () => ({ timestamp: "2025-01-01T00:00:00.000Z" }),
    getSessionFile: () => null,
  });

  assert.equal(modified.toISOString(), "2026-02-03T04:05:06.000Z");
});

test("falls back to the persisted header without stamping the current time", () => {
  const modified = sessionModifiedAt({
    getBranch: () => [],
    getHeader: () => ({ timestamp: "2024-06-07T08:09:10.000Z" }),
    getSessionFile: () => null,
  });

  assert.equal(modified.toISOString(), "2024-06-07T08:09:10.000Z");
});

test("read-only journal migration does not refresh a cold session's modified time", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-session-metadata-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });

  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const manager = SessionManager.create(cwd, undefined, { id: "metadata-migration" });
  manager.appendMessage({
    role: "user",
    content: "durable activity",
    timestamp: Date.parse("2024-05-02T03:04:04.000Z"),
  });
  manager.appendMessage(
    assistantMessage("durable response", Date.parse("2024-05-02T03:04:05.000Z")),
  );
  const sessionPath = manager.getSessionFile();
  assert.ok(sessionPath);
  const entries = (await readFile(sessionPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  entries[0]!.timestamp = "2024-05-01T00:00:00.000Z";
  entries[1]!.timestamp = "2024-05-02T03:04:04.000Z";
  entries[2]!.timestamp = "2024-05-02T03:04:05.000Z";
  await writeFile(sessionPath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);

  const before = (await listSessions()).sessions.find(
    (session) => session.id === "metadata-migration",
  );
  assert.ok(before);
  assert.equal(before.modified, "2024-05-02T03:04:05.000Z");

  const events = await getSessionEvents("metadata-migration");
  assert.equal(events.at(-1)?.time, Date.parse(before.modified));
  const after = (await listSessions()).sessions.find(
    (session) => session.id === "metadata-migration",
  );
  assert.ok(after);
  assert.equal(after.modified, before.modified);
});

test("cold rename publishes its canonical event and retains the same lastSeq", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-cold-rename-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });

  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const manager = SessionManager.create(cwd, undefined, { id: "cold-rename" });
  manager.appendMessage({
    role: "user",
    content: "before rename",
    timestamp: Date.parse("2024-06-01T00:00:00.000Z"),
  });
  manager.appendMessage(assistantMessage("ready", Date.parse("2024-06-01T00:00:01.000Z")));
  const eventsBeforeRename = await getSessionEvents("cold-rename");

  const hub = createStreamHub({ createRpcId: () => "registry-metadata-rpc" });
  const globals = globalThis as unknown as Record<PropertyKey, unknown>;
  const previousHub = globals[STREAM_HUB_SYMBOL];
  globals[STREAM_HUB_SYMBOL] = hub;
  t.after(() => {
    if (previousHub === undefined) delete globals[STREAM_HUB_SYMBOL];
    else globals[STREAM_HUB_SYMBOL] = previousHub;
  });

  const liveFrames: ServerRequest<MuxStreamPayload>[] = [];
  const liveSubscription = hub.subscribe("mux", {
    onFrame: (frame) => liveFrames.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  t.after(() => liveSubscription.close());
  await liveSubscription.ready;

  const seq = await renameSession("cold-rename", "Renamed while cold");
  assert.equal(seq, (eventsBeforeRename.at(-1)?.seq ?? -1) + 1);
  const eventFrame = liveFrames.find((frame) => frame.payload.type === "session/event");
  assert.ok(eventFrame);
  if (eventFrame.payload.type !== "session/event") assert.fail("Expected session/event frame");
  assert.equal(eventFrame.payload.sessionId, "cold-rename");
  assert.equal(eventFrame.payload.event.seq, seq);
  assert.equal(eventFrame.payload.event.type, "session_info_changed");

  const reconnectFrames: ServerRequest<MuxStreamPayload>[] = [];
  const reconnectSubscription = hub.subscribe("mux", {
    onFrame: (frame) => reconnectFrames.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  t.after(() => reconnectSubscription.close());
  await reconnectSubscription.ready;
  const retained = reconnectFrames.find(
    (frame) =>
      frame.payload.type === "session/subscribed" && frame.payload.sessionId === "cold-rename",
  );
  assert.ok(retained);
  if (retained.payload.type !== "session/subscribed") {
    assert.fail("Expected retained session/subscribed frame");
  }
  assert.equal(retained.payload.lastSeq, seq);
});

function assistantMessage(text: string, timestamp: number) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "anthropic-messages" as const,
    provider: "anthropic",
    model: "test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp,
  };
}

test("creates detached omitted and anchored forks without replacing the source", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-session-fork-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "project");
  const sessionDir = path.join(root, "sessions");
  await mkdir(cwd, { recursive: true });
  await mkdir(sessionDir, { recursive: true });

  const source = SessionManager.create(cwd, sessionDir, { id: "fork-source" });
  const user = { role: "user" as const, content: "hello", timestamp: 1 };
  const assistant = assistantMessage("world", 2);
  appendSessionEventJournal(source, {
    type: "turn_start",
    seq: 0,
    time: 1,
    data: { turnIndex: 0 },
  });
  appendSessionEventJournal(source, {
    type: "message_start",
    seq: 1,
    time: 2,
    data: { message: user },
  });
  appendSessionEventJournal(source, {
    type: "message_end",
    seq: 2,
    time: 3,
    data: { message: user },
  });
  source.appendMessage(user);
  appendSessionEventJournal(source, {
    type: "message_start",
    seq: 3,
    time: 4,
    data: { message: assistant },
  });
  appendSessionEventJournal(source, {
    type: "message_end",
    seq: 4,
    time: 5,
    data: { message: assistant },
  });
  source.appendMessage(assistant);
  appendSessionEventJournal(source, {
    type: "turn_end",
    seq: 5,
    time: 6,
    data: { turnIndex: 0 },
  });
  appendSessionEventJournal(source, {
    type: "agent_settled",
    seq: 6,
    time: 7,
    data: {},
  });
  const openTailUser = { role: "user" as const, content: "unfinished", timestamp: 3 };
  appendSessionEventJournal(source, {
    type: "turn_start",
    seq: 7,
    time: 8,
    data: { turnIndex: 1 },
  });
  appendSessionEventJournal(source, {
    type: "message_end",
    seq: 8,
    time: 9,
    data: { message: openTailUser },
  });
  source.appendMessage(openTailUser);

  const sourcePath = source.getSessionFile();
  assert.ok(sourcePath);
  const sourceBefore = await readFile(sourcePath, "utf8");
  const sourceLeaf = source.getLeafId();

  const anchored = createDetachedSessionFork(sourcePath, 1);
  assert.notEqual(anchored.getSessionId(), source.getSessionId());
  assert.equal(anchored.getCwd(), source.getCwd());
  assert.equal(anchored.getHeader()?.parentSession, sourcePath);
  assert.deepEqual(anchored.buildSessionContext().messages, [user, assistant]);
  const anchoredTail = anchored.getLeafEntry();
  assert.equal(anchoredTail?.type, "custom");
  if (anchoredTail?.type === "custom") {
    assert.equal((anchoredTail.data as { event?: { seq?: number } }).event?.seq, 5);
  }

  const omitted = createDetachedSessionFork(sourcePath);
  const omittedTail = omitted.getLeafEntry();
  assert.equal(omittedTail?.type, "custom");
  if (omittedTail?.type === "custom") {
    assert.equal((omittedTail.data as { event?: { seq?: number } }).event?.seq, 5);
  }
  assert.throws(() => createDetachedSessionFork(sourcePath, 8), {
    code: "pi_fork_unavailable",
  });

  assert.equal(source.getSessionId(), "fork-source");
  assert.equal(source.getSessionFile(), sourcePath);
  assert.equal(source.getLeafId(), sourceLeaf);
  assert.equal(await readFile(sourcePath, "utf8"), sourceBefore);
});

test("rejects in-log anchors without a completed and reliably persisted turn", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-session-fork-invalid-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "project");
  const sessionDir = path.join(root, "sessions");
  await mkdir(cwd, { recursive: true });
  await mkdir(sessionDir, { recursive: true });

  const source = SessionManager.create(cwd, sessionDir, { id: "fork-invalid-source" });
  const user = { role: "user" as const, content: "hello", timestamp: 1 };
  const assistant = assistantMessage("world", 2);
  appendSessionEventJournal(source, {
    type: "turn_start",
    seq: 0,
    time: 1,
    data: {},
  });
  appendSessionEventJournal(source, {
    type: "message_end",
    seq: 1,
    time: 2,
    data: { message: user },
  });
  source.appendCustomEntry("interloper", {});
  source.appendMessage(user);
  appendSessionEventJournal(source, {
    type: "message_end",
    seq: 2,
    time: 3,
    data: { message: assistant },
  });
  source.appendMessage(assistant);
  appendSessionEventJournal(source, {
    type: "turn_end",
    seq: 3,
    time: 4,
    data: {},
  });
  appendSessionEventJournal(source, {
    type: "agent_settled",
    seq: 4,
    time: 5,
    data: {},
  });
  const sourcePath = source.getSessionFile();
  assert.ok(sourcePath);

  assert.throws(() => createDetachedSessionFork(sourcePath, 1), {
    code: "pi_fork_unavailable",
  });
  assert.throws(() => createDetachedSessionFork(sourcePath, 4), {
    code: "pi_fork_unavailable",
  });

  const legacy = SessionManager.create(cwd, sessionDir, { id: "fork-legacy-source" });
  legacy.appendMessage(user);
  legacy.appendMessage(assistant);
  appendSessionEventJournal(legacy, {
    type: "message",
    seq: 0,
    time: 1,
    data: user,
  });
  appendSessionEventJournal(legacy, {
    type: "message",
    seq: 1,
    time: 2,
    data: assistant,
  });
  appendSessionEventJournal(legacy, {
    type: "turn_start",
    seq: 2,
    time: 3,
    data: {},
  });
  appendSessionEventJournal(legacy, {
    type: "message_end",
    seq: 3,
    time: 4,
    data: { message: user },
  });
  legacy.appendMessage(user);
  appendSessionEventJournal(legacy, {
    type: "message_end",
    seq: 4,
    time: 5,
    data: { message: assistant },
  });
  legacy.appendMessage(assistant);
  appendSessionEventJournal(legacy, {
    type: "turn_end",
    seq: 5,
    time: 6,
    data: {},
  });
  const legacyPath = legacy.getSessionFile();
  assert.ok(legacyPath);
  assert.throws(() => createDetachedSessionFork(legacyPath, 0), {
    code: "pi_fork_unavailable",
  });
});
