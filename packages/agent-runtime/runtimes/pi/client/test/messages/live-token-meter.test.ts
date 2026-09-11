import assert from "node:assert/strict";
import test from "node:test";

import type { PiAssistantMessage } from "@workbench/agent-runtime-pi-protocol/messages";

import { hasPiGeneratedContent, PiLiveTokenMeter } from "../../src/messages/live-token-meter";

test("estimates cumulative reasoning, text, and partial tool-call output", () => {
  const meter = new PiLiveTokenMeter();
  const message: PiAssistantMessage = {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "12345678" },
      { type: "text", text: "1234" },
      { type: "toolCall", id: "tool", name: "read", arguments: {} },
    ],
  };

  assert.equal(meter.observe(message, { "2": '{"path":"README.md"}' }), 9);
  assert.equal(hasPiGeneratedContent(message), true);
});

test("keeps live estimates monotonic across cumulative stream corrections", () => {
  const meter = new PiLiveTokenMeter();

  assert.equal(
    meter.observe({
      role: "assistant",
      content: [{ type: "thinking", thinking: "12345678" }],
    }),
    2,
  );
  assert.equal(
    meter.observe({
      role: "assistant",
      content: [{ type: "thinking", thinking: "1234" }],
    }),
    2,
  );
});

test("estimates CJK output from UTF-8 bytes instead of UTF-16 character count", () => {
  const meter = new PiLiveTokenMeter();

  assert.equal(
    meter.observe({
      role: "assistant",
      content: [{ type: "thinking", thinking: "你好世界" }],
    }),
    3,
  );
});

test("uses positive provider output as the authoritative generated-token count", () => {
  const meter = new PiLiveTokenMeter();
  meter.observe({
    role: "assistant",
    content: [{ type: "text", text: "123456789012" }],
  });

  assert.equal(
    meter.observe({
      role: "assistant",
      content: [{ type: "text", text: "Done" }],
      usage: {
        input: 10,
        output: 2,
        reasoning: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 12,
      },
    }),
    2,
  );
});

test("does not estimate hidden redacted reasoning", () => {
  const message: PiAssistantMessage = {
    role: "assistant",
    content: [{ type: "thinking", thinking: "encrypted", redacted: true }],
  };

  assert.equal(new PiLiveTokenMeter().observe(message), undefined);
  assert.equal(hasPiGeneratedContent(message), false);
});
