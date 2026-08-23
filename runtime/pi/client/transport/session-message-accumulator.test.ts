import assert from "node:assert/strict";
import test from "node:test";

import type { PiEvent } from "../../contracts";
import type {
  SessionMessageSnapshotPayload,
  SessionMessageUpdatePayload,
} from "../../stream-contracts";

const { SessionMessageAccumulator } = (await import(
  new URL("./session-message-accumulator.ts", import.meta.url).href
)) as typeof import("./session-message-accumulator");

function update(
  revision: number,
  value: SessionMessageUpdatePayload["update"],
): SessionMessageUpdatePayload {
  return {
    type: "session/message-update",
    format: "pi-messages-v1",
    sessionId: "session-1",
    streamId: "stream-1",
    revision,
    startSeq: 10,
    time: 1_725_000_000_000 + revision,
    message: { role: "assistant", model: "model-1" },
    update: value,
  };
}

function messageFrom(result: { kind: string; event?: PiEvent }): Record<string, unknown> {
  assert.equal(result.kind, "event");
  assert.ok(result.event);
  const message = result.event.message;
  assert.ok(typeof message === "object" && message !== null && !Array.isArray(message));
  return message as Record<string, unknown>;
}

test("materializes interleaved text, thinking, and tool-call deltas", () => {
  const accumulator = new SessionMessageAccumulator();
  accumulator.start({ role: "assistant", content: [] }, 10, 1_725_000_000_000);

  messageFrom(accumulator.applyUpdate(update(1, { type: "text_start", contentIndex: 0 })));
  messageFrom(
    accumulator.applyUpdate(update(2, { type: "text_delta", contentIndex: 0, delta: "Hello" })),
  );
  messageFrom(accumulator.applyUpdate(update(3, { type: "thinking_start", contentIndex: 1 })));
  messageFrom(
    accumulator.applyUpdate(
      update(4, { type: "thinking_delta", contentIndex: 1, delta: "secret" }),
    ),
  );
  messageFrom(
    accumulator.applyUpdate(
      update(5, {
        type: "text_end",
        contentIndex: 0,
        content: "Hello!",
        contentSignature: "",
      }),
    ),
  );
  const thinkingEnd = messageFrom(
    accumulator.applyUpdate(
      update(6, {
        type: "thinking_end",
        contentIndex: 1,
        content: "[Reasoning redacted]",
        contentSignature: "opaque",
        redacted: true,
      }),
    ),
  ) as { content: Array<Record<string, unknown>> };

  assert.deepEqual(thinkingEnd.content, [
    { type: "text", text: "Hello!", textSignature: "" },
    {
      type: "thinking",
      thinking: "[Reasoning redacted]",
      thinkingSignature: "opaque",
      redacted: true,
    },
  ]);

  messageFrom(
    accumulator.applyUpdate(
      update(7, {
        type: "toolcall_start",
        contentIndex: 2,
        id: "tool-1",
        toolName: "search",
      }),
    ),
  );
  const partialTool = messageFrom(
    accumulator.applyUpdate(
      update(8, { type: "toolcall_delta", contentIndex: 2, delta: '{"query":"hel' }),
    ),
  ) as { content: Array<Record<string, unknown>> };
  assert.deepEqual(partialTool.content[2]?.arguments, { query: "hel" });

  const snapshot: SessionMessageSnapshotPayload = {
    type: "session/message-snapshot",
    format: "pi-messages-v1",
    sessionId: "session-1",
    streamId: "stream-1",
    revision: 8,
    startSeq: 10,
    time: 1_725_000_000_008,
    message: partialTool as unknown as SessionMessageSnapshotPayload["message"],
    toolCallJson: { "2": '{"query":"hel' },
  };
  const resumed = new SessionMessageAccumulator();
  messageFrom(resumed.applySnapshot(snapshot));
  const completedJson = messageFrom(
    resumed.applyUpdate(update(9, { type: "toolcall_delta", contentIndex: 2, delta: 'lo"}' })),
  ) as { content: Array<Record<string, unknown>> };
  assert.deepEqual(completedJson.content[2]?.arguments, { query: "hello" });

  const completedTool = messageFrom(
    resumed.applyUpdate(
      update(10, {
        type: "toolcall_end",
        contentIndex: 2,
        toolCall: {
          type: "toolCall",
          id: "tool-1",
          name: "search",
          arguments: { query: "hello", limit: 3 },
          thoughtSignature: "thought",
          namespace: "builtin",
        },
      }),
    ),
  ) as { content: Array<Record<string, unknown>> };
  assert.deepEqual(completedTool.content[2], {
    type: "toolCall",
    id: "tool-1",
    name: "search",
    arguments: { query: "hello", limit: 3 },
    thoughtSignature: "thought",
    namespace: "builtin",
  });
});

test("deduplicates revisions, freezes on gaps, and accepts an authoritative snapshot repair", () => {
  const accumulator = new SessionMessageAccumulator();
  accumulator.start({ role: "assistant", content: [] }, 10, 1);
  assert.equal(
    accumulator.applyUpdate(update(1, { type: "text_start", contentIndex: 0 })).kind,
    "event",
  );
  assert.equal(
    accumulator.applyUpdate(update(1, { type: "text_start", contentIndex: 0 })).kind,
    "ignored",
  );
  assert.equal(
    accumulator.applyUpdate(
      update(3, { type: "text_delta", contentIndex: 0, delta: "missing two" }),
    ).kind,
    "gap",
  );
  assert.equal(
    accumulator.applyUpdate(update(2, { type: "text_delta", contentIndex: 0, delta: "two" })).kind,
    "ignored",
  );

  const repaired = accumulator.applySnapshot({
    type: "session/message-snapshot",
    format: "pi-messages-v1",
    sessionId: "session-1",
    streamId: "stream-1",
    revision: 3,
    startSeq: 10,
    time: 3,
    message: { role: "assistant", content: [{ type: "text", text: "repaired" }] },
  });
  assert.equal(repaired.kind, "event");
  assert.equal(
    accumulator.applyUpdate(update(3, { type: "text_delta", contentIndex: 0, delta: "old" })).kind,
    "ignored",
  );
  const next = messageFrom(
    accumulator.applyUpdate(update(4, { type: "text_delta", contentIndex: 0, delta: "!" })),
  ) as { content: Array<{ text?: string }> };
  assert.equal(next.content[0]?.text, "repaired!");
});
