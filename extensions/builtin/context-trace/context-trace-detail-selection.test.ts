import assert from "node:assert/strict";
import test from "node:test";

import type {
  SessionContextTraceCaptureMetadata,
  SessionContextTraceEvent,
  SessionContextTraceJsonValue,
} from "@/runtime/pi/rpc-contracts";

import { contextTraceSelectedRawValue } from "./context-trace-detail-selection";

const capture: SessionContextTraceCaptureMetadata = {
  originalBytes: 1,
  capturedBytes: 1,
  truncated: false,
  redactedPaths: [],
};

const promptEvent = {
  schemaVersion: 1,
  traceId: "activation:1",
  sessionId: "session",
  activationId: "activation",
  seq: 1,
  time: 1,
  kind: "prompt-composition",
  detailBytes: 1,
  truncated: false,
  redacted: false,
  detail: {
    type: "prompt-composition",
    prompt: { ...capture, text: "Only this user prompt", originalCharacters: 21 },
    systemPrompt: { ...capture, text: "Large system prompt", originalCharacters: 19 },
    systemPromptWithoutSkills: {
      ...capture,
      text: "System prompt without skills",
      originalCharacters: 28,
    },
    systemPromptSources: [
      {
        kind: "replacement",
        scope: "project",
        path: "/workspace/.pi/SYSTEM.md",
        content: { ...capture, text: "Project prompt", originalCharacters: 14 },
      },
    ],
    systemPromptOptions: {
      cwd: "/workspace",
      contextFiles: [],
      skills: [{ name: "example" }],
    },
    images: { value: [], capture },
    tools: [
      {
        name: "bash",
        description: "Run a command",
        active: true,
        source: { path: "bash.ts", source: "builtin", scope: "user", origin: "top-level" },
        parameters: { value: { type: "object" }, capture },
      },
    ],
  },
} satisfies SessionContextTraceEvent;

test("projects a selected user row without serializing the rest of prompt composition", () => {
  assert.deepEqual(
    contextTraceSelectedRawValue(promptEvent, {
      type: "prompt-section",
      section: "user-prompt",
    }),
    promptEvent.detail.prompt,
  );
});

test("projects the Skills-free system prompt and one selected loading source", () => {
  assert.deepEqual(
    contextTraceSelectedRawValue(promptEvent, {
      type: "prompt-section",
      section: "system-prompt",
    }),
    promptEvent.detail.systemPromptWithoutSkills,
  );
  assert.deepEqual(
    contextTraceSelectedRawValue(promptEvent, { type: "system-prompt-source", index: 0 }),
    promptEvent.detail.systemPromptSources[0],
  );
});

test("projects one selected tool instead of every prompt resource", () => {
  assert.deepEqual(
    contextTraceSelectedRawValue(promptEvent, { type: "prompt-tool", toolName: "bash" }),
    promptEvent.detail.tools[0],
  );
});

test("projects one context message and one output block by their source indexes", () => {
  const outputValue: SessionContextTraceJsonValue = {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "Reasoning" },
      { type: "text", text: "Selected output" },
    ],
  };
  const contextEvent = {
    ...promptEvent,
    traceId: "activation:2",
    seq: 2,
    kind: "context-snapshot",
    detail: {
      type: "context-snapshot",
      messageCount: 2,
      messages: {
        value: [
          { role: "system", content: "System" },
          { role: "user", content: "Selected message" },
        ],
        capture,
      },
    },
  } satisfies SessionContextTraceEvent;
  const outputEvent = {
    ...promptEvent,
    traceId: "activation:3",
    seq: 3,
    kind: "model-output",
    detail: {
      type: "model-output",
      message: {
        value: outputValue,
        capture,
      },
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
    },
  } satisfies SessionContextTraceEvent;

  assert.deepEqual(
    contextTraceSelectedRawValue(contextEvent, {
      type: "context-message",
      sourceIndex: 1,
    }),
    { role: "user", content: "Selected message" },
  );
  assert.deepEqual(
    contextTraceSelectedRawValue(outputEvent, {
      type: "output-block",
      contentIndex: 1,
    }),
    { type: "text", text: "Selected output" },
  );
});
