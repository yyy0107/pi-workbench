import assert from "node:assert/strict";
import test from "node:test";

import type { ReasoningMessagePart, ToolCallMessagePart } from "@assistant-ui/react";

const { latestReasoningPreview, timelineStats, timelineSteps } = (await import(
  new URL("./tool-timeline-model.ts", import.meta.url).href
)) as typeof import("./tool-timeline-model");

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

test("uses the latest non-empty reasoning line for the collapsed preview", () => {
  assert.equal(
    latestReasoningPreview("First thought\n\nNewest   reasoning detail"),
    "Newest reasoning detail",
  );
  assert.equal(latestReasoningPreview("123456789", 6), "…56789");
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
