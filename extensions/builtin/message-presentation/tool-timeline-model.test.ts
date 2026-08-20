import assert from "node:assert/strict";
import test from "node:test";

import type { ReasoningMessagePart, ToolCallMessagePart } from "@assistant-ui/react";
import {
  liveReasoningPreview,
  reasoningPartTiming,
  reasoningPreview,
  timelineEntries,
  timelineStats,
  timelineSteps,
} from "./tool-timeline-model";

function tool(toolName: string, args: Record<string, unknown>): ToolCallMessagePart {
  return {
    type: "tool-call",
    toolCallId: `${toolName}-call`,
    toolName,
    args: args as ToolCallMessagePart["args"],
    argsText: JSON.stringify(args),
  };
}

test("maps reasoning and common Pi tools to compact timeline steps", () => {
  const reasoning = {
    type: "reasoning",
    text: "Planning the change",
  } satisfies ReasoningMessagePart;

  assert.deepEqual(
    timelineSteps([
      reasoning,
      tool("read", { path: "/workspace/thread.tsx" }),
      tool("bash", { command: "pnpm vitest" }),
      tool("edit", { path: "/workspace/composer.tsx", edits: [] }),
      tool("web_crawl", { start_urls: ["https://example.com/docs"] }),
    ]),
    [
      { kind: "thinking", chip: "Planning the change" },
      { kind: "read", chip: "thread.tsx" },
      { kind: "ran", chip: "pnpm vitest" },
      { kind: "edited", chip: "composer.tsx" },
      { kind: "searched", chip: "https://example.com/docs" },
    ],
  );
});

test("uses the beginning of reasoning for the collapsed preview", () => {
  assert.equal(
    reasoningPreview("First thought\n\nNewest   reasoning detail"),
    "First thought Newest reasoning detail",
  );
  assert.equal(reasoningPreview("123456789", 6), "12345…");
});

test("uses the latest reasoning text for the live collapsed preview", () => {
  assert.equal(
    liveReasoningPreview("First thought\n\nNewest   reasoning detail"),
    "First thought Newest reasoning detail",
  );
  assert.equal(liveReasoningPreview("123456789", 6), "…56789");
});

test("restores reasoning timing from stable provider metadata", () => {
  const reasoning = (pi: Record<string, number>): ReasoningMessagePart => ({
    type: "reasoning",
    text: "Plan",
    providerMetadata: { pi },
  });

  assert.deepEqual(reasoningPartTiming(reasoning({ startedAt: 10_000 })), {
    startedAt: 10_000,
  });
  assert.deepEqual(reasoningPartTiming(reasoning({ startedAt: 10_000, durationMs: 2_600 })), {
    startedAt: 10_000,
    completedAt: 12_600,
  });
  assert.deepEqual(reasoningPartTiming(reasoning({ durationMs: 2_600 })), {
    startedAt: 0,
    completedAt: 2_600,
  });
});

test("groups only adjacent tools carrying the same parallel batch metadata", () => {
  const parallelTool = (toolName: string, batchId: string): ToolCallMessagePart => ({
    ...tool(toolName, {}),
    providerMetadata: {
      pi: {
        parallelToolBatchId: batchId,
        parallelToolBatchSize: 2,
      },
    },
  });
  const reasoning = {
    type: "reasoning",
    text: "Plan",
  } satisfies ReasoningMessagePart;

  const entries = timelineEntries([
    reasoning,
    parallelTool("read", "batch-a"),
    parallelTool("search", "batch-a"),
    tool("bash", { command: "pnpm test" }),
    tool("read", { path: "not-parallel.ts" }),
    parallelTool("read", "batch-b"),
    parallelTool("edit", "batch-b"),
  ]);

  assert.equal(entries.length, 5);
  assert.deepEqual(
    entries.map((entry) =>
      entry.kind === "part"
        ? entry.part.type === "reasoning"
          ? "reasoning"
          : entry.part.toolName
        : `${entry.batchId}:${entry.parts.map((part) => part.toolName).join(",")}`,
    ),
    ["reasoning", "batch-a:read,search", "bash", "read", "batch-b:read,edit"],
  );
});

test("aggregates edited and written lines by file", () => {
  assert.deepEqual(
    timelineStats([
      tool("edit", {
        path: "/workspace/thread.tsx",
        edits: [{ oldText: "old one\nold two", newText: "new one\nnew two\nnew three" }],
      }),
      tool("write", {
        path: "/workspace/thread.tsx",
        content: "appended one\nappended two\n",
      }),
      tool("read", { path: "/workspace/ignored.tsx" }),
    ]),
    [{ file: "thread.tsx", added: 5, removed: 2 }],
  );
});
