import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createSessionMessageChunkData } from "@workbench/agent-runtime-pi-protocol/stream";
import type { SessionEvent } from "@workbench/agent-runtime-pi-protocol/rpc";
import {
  ensureSessionPersistence,
  reconcileInterruptedSession,
} from "../../src/sessions/session-interruption";
import {
  appendSessionEventJournal,
  initializeSessionEventJournal,
  readSessionEventJournal,
} from "../../src/sessions/session-event-journal";
import {
  missingSessionResumeCheckpointFromBranch,
  sessionResumeStateFromBranch,
  SESSION_RESUME_CHECKPOINT_CUSTOM_TYPE,
} from "../../src/sessions/session-resume";

function fixture(t: test.TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), "pi-interruption-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manager = SessionManager.create(root, root);
  ensureSessionPersistence(manager);
  initializeSessionEventJournal(manager, []);
  const events: SessionEvent[] = [];
  const append = (type: string, data: unknown = {}) => {
    const event = appendSessionEventJournal(manager, {
      type,
      seq: events.length,
      time: 1_000 + events.length,
      data,
    });
    events.push(event);
    return event;
  };
  append("agent_start");
  const user = { role: "user" as const, content: "Finish the task", timestamp: 1_000 };
  append("message_end", { message: user });
  manager.appendMessage(user);
  return { manager, append, events };
}

const partial = {
  role: "assistant" as const,
  content: [],
  timestamp: 1_002,
  provider: "test",
  model: "test-model",
  api: "openai-completions" as const,
  usage: {
    input: 1,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 1,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop" as const,
};

function recover(manager: SessionManager) {
  const reopened = SessionManager.open(manager.getSessionFile()!);
  ensureSessionPersistence(reopened);
  const events = readSessionEventJournal(reopened);
  reconcileInterruptedSession(reopened, events);
  const candidate = missingSessionResumeCheckpointFromBranch(reopened.getBranch(), events);
  if (candidate) reopened.appendCustomEntry(SESSION_RESUME_CHECKPOINT_CUSTOM_TYPE, candidate.value);
  return {
    reopened,
    events,
    checkpoint: sessionResumeStateFromBranch(reopened.getBranch()).checkpoint,
  };
}

test("persists the first user request before any assistant has finished", (t) => {
  const { manager } = fixture(t);
  const { reopened, checkpoint } = recover(manager);
  assert.equal(reopened.buildSessionContext().messages[0]?.role, "user");
  assert.equal(checkpoint?.reason, "process-interrupted");
  assert.equal(checkpoint?.capability, "ready");
});

test("recovers a complete user or tool message when only its start event reached disk", (t) => {
  for (const message of [
    { role: "user" as const, content: "The newly queued request", timestamp: 1_003 },
    {
      role: "toolResult" as const,
      toolCallId: "read-1",
      toolName: "read",
      content: [{ type: "text" as const, text: "Durable result" }],
      isError: false,
      timestamp: 1_003,
    },
  ]) {
    const { manager, append } = fixture(t);
    if (message.role === "toolResult")
      append("tool_execution_start", { toolCallId: "read-1", toolName: "read" });
    append("message_start", { message });
    const { reopened, checkpoint } = recover(manager);
    assert.deepEqual(reopened.buildSessionContext().messages.at(-2), message);
    assert.equal(checkpoint?.capability, "ready");
  }
});

test("recovers partial text, thinking, and tool arguments once across repeated cold opens", (t) => {
  const { manager, append } = fixture(t);
  const start = append("message_start", { message: partial });
  const { content: _content, ...metadata } = partial;
  append(
    "message_update",
    createSessionMessageChunkData("stream-1", 1, 6, start.seq, metadata, [
      { type: "text_start", contentIndex: 0 },
      { type: "text_delta", contentIndex: 0, delta: "Saved partial answer" },
      { type: "thinking_start", contentIndex: 1 },
      { type: "thinking_delta", contentIndex: 1, delta: "Saved reasoning" },
      { type: "toolcall_start", contentIndex: 2, id: "not-executed", toolName: "write" },
      { type: "toolcall_delta", contentIndex: 2, delta: '{"path":"file.txt"' },
    ]),
  );
  const { reopened, events, checkpoint } = recover(manager);
  const message = reopened.buildSessionContext().messages.at(-1);
  assert.equal(message?.role, "assistant");
  if (message?.role !== "assistant") return;
  assert.equal(message.stopReason, "aborted");
  assert.deepEqual(message.content, [
    { type: "text", text: "Saved partial answer" },
    { type: "thinking", thinking: "Saved reasoning" },
    { type: "toolCall", id: "not-executed", name: "write", arguments: { path: "file.txt" } },
  ]);
  assert.equal(
    checkpoint?.capability,
    "ready",
    "an unexecuted partial tool call is safe to regenerate",
  );
  const repeated = recover(reopened);
  assert.deepEqual(repeated.events, events);
  assert.deepEqual(repeated.checkpoint, checkpoint);
});

test("does not replay a tool whose result was not durably recorded", (t) => {
  const { manager, append } = fixture(t);
  const message = {
    ...partial,
    stopReason: "toolUse" as const,
    content: [
      { type: "toolCall" as const, id: "write-1", name: "write", arguments: { path: "out.txt" } },
    ],
  };
  append("message_end", { message });
  manager.appendMessage(message);
  append("tool_execution_start", { toolCallId: "write-1", toolName: "write" });
  append("tool_execution_end", { toolCallId: "write-1", result: { content: [] }, isError: false });
  const { checkpoint } = recover(manager);
  assert.equal(checkpoint?.capability, "confirmation-required");
  assert.equal(checkpoint?.blockedBy, "ambiguous-tools");
});

test("preserves completed answers even if the process died before agent_settled", (t) => {
  const { manager, append } = fixture(t);
  const message = { ...partial, content: [{ type: "text" as const, text: "Done" }] };
  append("message_end", { message });
  // Exercise the crash window before Pi appends the native assistant message, too.
  const { reopened, events, checkpoint } = recover(manager);
  assert.deepEqual(reopened.buildSessionContext().messages.at(-1), message);
  assert.equal(checkpoint, undefined);
  assert.equal(events.at(-1)?.type, "agent_settled");
  assert.equal(events.filter((event) => event.type === "message_end").length, 2);
});

test("normal shutdown after a tool result still creates a resumable interruption", (t) => {
  const { manager, append, events } = fixture(t);
  const message = { ...partial, stopReason: "toolUse" as const, content: [] };
  append("message_end", { message });
  manager.appendMessage(message);
  append("tool_execution_start", { toolCallId: "read-1", toolName: "read" });
  const result = {
    role: "toolResult" as const,
    toolCallId: "read-1",
    toolName: "read",
    content: [{ type: "text" as const, text: "Operation aborted" }],
    isError: true,
    timestamp: 1_005,
  };
  append("message_end", { message: result });
  manager.appendMessage(result);
  append("agent_settled");
  reconcileInterruptedSession(manager, events, 0);
  const candidate = missingSessionResumeCheckpointFromBranch(manager.getBranch(), events);
  assert.equal(candidate?.value.reason, "process-interrupted");
  assert.equal(candidate?.value.ambiguousTools, undefined);
  const length = events.length;
  reconcileInterruptedSession(manager, events, 0);
  assert.equal(events.length, length);
});

test("keeps recovery appends readable after a torn final JSONL record", (t) => {
  const { manager } = fixture(t);
  appendFileSync(manager.getSessionFile()!, '{"type":"custom","id":"torn');
  const { reopened, checkpoint } = recover(manager);
  assert.equal(checkpoint?.reason, "process-interrupted");
  assert.equal(recover(reopened).checkpoint?.checkpointId, checkpoint?.checkpointId);
  assert.match(readFileSync(manager.getSessionFile()!, "utf8"), /"id":"torn\n/);
});

test("recovers the first streamed answer after its writer process is forcibly killed", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "pi-killed-session-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      new URL("../../../../../../../scripts/register-typescript-test-loader.mjs", import.meta.url)
        .href,
      "--input-type=module",
      "--eval",
      `
      import { SessionManager } from ${JSON.stringify(import.meta.resolve("@earendil-works/pi-coding-agent"))};
      import { ensureSessionPersistence } from ${JSON.stringify(new URL("../../src/sessions/session-interruption.ts", import.meta.url).href)};
      import { appendSessionEventJournal, initializeSessionEventJournal } from ${JSON.stringify(new URL("../../src/sessions/session-event-journal.ts", import.meta.url).href)};
      const manager = SessionManager.create(${JSON.stringify(root)}, ${JSON.stringify(root)});
      ensureSessionPersistence(manager);
      initializeSessionEventJournal(manager, []);
      let seq = 0;
      const append = (type, data = {}) => appendSessionEventJournal(manager, { type, seq: seq++, time: 1000, data });
      append("agent_start");
      const user = { role: "user", content: "Keep the first turn", timestamp: 1000 };
      append("message_end", { message: user });
      manager.appendMessage(user);
      append("message_start", { message: ${JSON.stringify(partial)} });
      append("message_update", { message: { ...${JSON.stringify(partial)}, content: [{ type: "text", text: "Saved before SIGKILL" }] } });
      process.kill(process.pid, "SIGKILL");
    `,
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  assert.equal(child.signal, "SIGKILL", child.stderr);
  const file = readdirSync(root).find((name) => name.endsWith(".jsonl"));
  assert.ok(file);
  const { reopened, checkpoint } = recover(SessionManager.open(path.join(root, file)));
  assert.match(JSON.stringify(reopened.buildSessionContext().messages), /Saved before SIGKILL/);
  assert.equal(checkpoint?.reason, "process-interrupted");
  assert.equal(checkpoint?.capability, "ready");
});
