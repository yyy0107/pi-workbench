import assert from "node:assert/strict";
import test from "node:test";

import type { PiAssistantMessage, PiEvent } from "@workbench/agent-runtime-pi-protocol/messages";

import { PiSessionManager } from "../../src/runtime/manager";

test("keeps the assistant turn running between model output and tool execution", async (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session");
  const internals = session as unknown as { handleEvent(event: PiEvent): void };
  const toolMessage: PiAssistantMessage = {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "Read the file first" },
      { type: "toolCall", id: "read-1", name: "read", arguments: { path: "README.md" } },
    ],
    stopReason: "toolUse",
    timestamp: 1_000,
  };
  const emit = async (event: PiEvent) => {
    internals.handleEvent(event);
    await Promise.resolve();
  };

  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: toolMessage });
  const assistantKey = session.snapshot.getSnapshot().nodeKeys.at(-1);
  assert.ok(assistantKey);
  const currentAssistant = () => {
    const node = session.node(assistantKey).getSnapshot();
    assert.equal(node?.kind, "assistant");
    if (node?.kind !== "assistant") throw new Error("Missing assistant turn");
    return node;
  };
  assert.equal(currentAssistant().status, "running");

  await emit({ type: "message_end", message: toolMessage });
  assert.equal(session.snapshot.getSnapshot().isRunning, true);
  assert.equal(currentAssistant().status, "running");

  await emit({ type: "tool_execution_start", toolCallId: "read-1" });
  assert.equal(currentAssistant().status, "running");
  await emit({
    type: "tool_execution_end",
    toolCallId: "read-1",
    result: { content: [{ type: "text", text: "File contents" }] },
    isError: false,
  });
  const waiting = currentAssistant();
  assert.equal(waiting.status, "running");
  const reasoning = waiting.blocks[0];
  const tool = waiting.blocks[1];
  assert.equal(reasoning?.kind === "reasoning" && reasoning.status, "complete");
  assert.equal(tool?.kind === "tool-call" && tool.status, "complete");

  await emit({ type: "message_start", message: { role: "assistant", content: [] } });
  assert.equal(currentAssistant().status, "running");
  assert.deepEqual(currentAssistant().blocks, waiting.blocks);
  const answer: PiAssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: "Here is the answer" }],
    stopReason: "stop",
    timestamp: 2_000,
  };
  await emit({ type: "message_update", message: answer });
  assert.equal(currentAssistant().status, "running");
  await emit({ type: "message_end", message: answer });
  assert.equal(session.snapshot.getSnapshot().isRunning, false);
  assert.equal(currentAssistant().status, "complete");
  assert.deepEqual(currentAssistant().blocks.slice(0, 2), waiting.blocks);
});

test("permanently disposes and evicts a deleted client session", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string };
    assert.equal(request.method, "session.delete");
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value: { deleted: true } },
    });
  };

  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const cached = manager.getSession("local-session", "remote-session");
  let disposalNotifications = 0;
  cached.subscribe(() => {
    disposalNotifications += 1;
  });

  const internals = manager as unknown as {
    sessions: Map<string, unknown>;
    aliases: Map<string, string>;
  };
  const connectionInternals = manager.connections as unknown as {
    sessions: Map<string, unknown>;
    sessionWatermarks: Map<string, number>;
    sessionMessageAccumulators: Map<string, unknown>;
    endedSessionMessageStreams: Map<string, string>;
  };
  connectionInternals.sessionWatermarks.set("remote-session", 42);
  connectionInternals.sessionMessageAccumulators.set("remote-session", {});
  connectionInternals.endedSessionMessageStreams.set("remote-session", "stream-1");

  await manager.deleteThread("remote-session");

  // The manager retains its independently-owned current draft while evicting both aliases for
  // the deleted durable Session.
  assert.equal(internals.sessions.size, 1);
  assert.equal(internals.aliases.size, 0);
  assert.equal(connectionInternals.sessions.has("remote-session"), false);
  assert.equal(connectionInternals.sessionWatermarks.has("remote-session"), false);
  assert.equal(connectionInternals.sessionMessageAccumulators.has("remote-session"), false);
  assert.equal(connectionInternals.endedSessionMessageStreams.has("remote-session"), false);
  assert.equal(disposalNotifications, 1);
  assert.deepEqual(cached.getSnapshot().messages, []);
  assert.deepEqual(cached.snapshot.getSnapshot().composer.queue?.items ?? [], []);

  const recreated = manager.getSession("local-session", "remote-session");
  assert.notStrictEqual(recreated, cached);
});

test("manager disposal releases every cached session and alias", () => {
  const manager = new PiSessionManager();
  const session = manager.getSession("local-session", "remote-session");
  const internals = manager as unknown as {
    sessions: Map<string, unknown>;
    aliases: Map<string, string>;
    pendingQueues: Map<string, unknown>;
  };
  internals.aliases.set("local-session", "remote-session");

  manager.dispose();

  assert.equal(internals.sessions.size, 0);
  assert.equal(internals.aliases.size, 0);
  assert.equal(internals.pendingQueues.size, 0);
  assert.deepEqual(session.getSnapshot().messages, []);
  assert.throws(() => manager.getSession("another-local", "another-remote"), /disposed/);
});

test("projects current messages once for each published snapshot", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session", "remote-session");
  const internals = session as unknown as {
    currentMessages(): ReturnType<typeof session.getSnapshot>["messages"];
    publishMessages(): void;
  };
  const project = internals.currentMessages.bind(session);
  let projectionCount = 0;
  internals.currentMessages = () => {
    projectionCount += 1;
    return project();
  };

  internals.publishMessages();

  assert.equal(projectionCount, 1);
});
