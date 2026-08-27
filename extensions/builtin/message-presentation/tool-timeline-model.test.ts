import assert from "node:assert/strict";
import test from "node:test";

import type {
  DataMessagePart,
  ReasoningMessagePart,
  ToolCallMessagePart,
} from "@assistant-ui/react";
import { WrenchIcon } from "lucide-react";

import { defineMessage } from "@/i18n";
import type { DataPresentationDefinition, ToolPresentationDefinition } from "@/platform/extensions";
import {
  activeToolPresentationLabel,
  dataTimelineState,
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

function data(name: string, value: unknown): DataMessagePart {
  return { type: "data", name, data: value };
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

test("admits only data parts that opt into the shared work timeline", () => {
  const presentations = {
    "workbench.progress": {
      display: "timeline",
      isVisible: (part) => part.data !== "hidden",
      isActive: (part) => part.data === "running",
    },
  } satisfies Readonly<Record<string, DataPresentationDefinition>>;

  assert.deepEqual(dataTimelineState(data("workbench.progress", "running"), presentations), {
    active: true,
  });
  assert.deepEqual(dataTimelineState(data("workbench.progress", "complete"), presentations), {
    active: false,
  });
  assert.equal(dataTimelineState(data("workbench.progress", "hidden"), presentations), undefined);
  assert.equal(dataTimelineState(data("unregistered", "running"), presentations), undefined);
  assert.deepEqual(timelineSteps([data("workbench.progress", "complete")]), [{ kind: "data" }]);
});

test("keeps a data step in sequence with reasoning and tools", () => {
  const recognition = data("workbench.image-recognition", { status: "succeeded" });
  const parts = [
    { type: "reasoning", text: "Inspect the request" } satisfies ReasoningMessagePart,
    recognition,
    tool("read", { path: "/workspace/result.ts" }),
  ];

  assert.deepEqual(
    timelineEntries(parts).map((entry) =>
      entry.kind === "part"
        ? entry.part.type === "data"
          ? entry.part.name
          : entry.part.type === "reasoning"
            ? "reasoning"
            : entry.part.toolName
        : entry.batchId,
    ),
    ["reasoning", "workbench.image-recognition", "read"],
  );
  assert.deepEqual(
    timelineSteps(parts).map((step) => step.kind),
    ["thinking", "data", "read"],
  );
});

test("isolates failing data presentation predicates", () => {
  const visibleFailure = {
    progress: {
      display: "timeline",
      isVisible: () => {
        throw new Error("broken visibility");
      },
    },
  } satisfies Readonly<Record<string, DataPresentationDefinition>>;
  const activeFailure = {
    progress: {
      display: "timeline",
      isActive: () => {
        throw new Error("broken activity");
      },
    },
  } satisfies Readonly<Record<string, DataPresentationDefinition>>;

  assert.equal(dataTimelineState(data("progress", {}), visibleFailure), undefined);
  assert.deepEqual(dataTimelineState(data("progress", {}), activeFailure), { active: false });
});

test("uses an exact registered tool presentation without changing fallback classification", () => {
  const presentation = {
    label: "Deployed",
    activeLabel: "Deploying",
    icon: WrenchIcon,
    summarize: (part) => {
      const args = part.args as { environment?: unknown };
      return typeof args.environment === "string" ? args.environment : undefined;
    },
  } satisfies ToolPresentationDefinition;

  const [step] = timelineSteps([tool("deploy", { environment: "production" })], {
    deploy: presentation,
  });

  assert.equal(step?.kind, "used");
  assert.equal(step?.chip, "production");
  assert.equal(step?.presentation, presentation);
});

test("preserves a localizable registered tool summary until the timeline renders it", () => {
  const summary = defineMessage("extensions.interactiveRequests.askUserTool.questionCount", {
    count: 2,
  });
  const presentation = {
    label: "Asked user",
    activeLabel: "Asking user",
    icon: WrenchIcon,
    summarize: () => summary,
  } satisfies ToolPresentationDefinition;

  const [step] = timelineSteps([tool("ask_user", { questions: [{}, {}] })], {
    ask_user: presentation,
  });

  assert.notEqual(step?.kind, "data");
  if (!step || step.kind === "data") return;
  assert.equal(step.chip, summary);
});

test("resolves a stream-safe active label from partial tool arguments", () => {
  const part = tool("ask_user", { questions: [{ id: "partial" }] });
  const presentation = {
    label: "Asked user",
    activeLabel: "Asking user",
    getActiveLabel: () =>
      defineMessage("extensions.interactiveRequests.askUserTool.activityGenerating"),
    icon: WrenchIcon,
  } satisfies ToolPresentationDefinition;

  assert.deepEqual(
    activeToolPresentationLabel(part, presentation),
    defineMessage("extensions.interactiveRequests.askUserTool.activityGenerating"),
  );
  assert.equal(
    activeToolPresentationLabel(part, {
      ...presentation,
      getActiveLabel: () => {
        throw new Error("broken active label");
      },
    }),
    "Asking user",
  );
});

test("falls back to the existing summary when an extension summary is unavailable", () => {
  const presentation = {
    label: "Inspected",
    activeLabel: "Inspecting",
    icon: WrenchIcon,
    summarize: () => {
      throw new Error("broken presentation");
    },
  } satisfies ToolPresentationDefinition;

  const [step] = timelineSteps([tool("inspect", { path: "/workspace/thread.tsx" })], {
    inspect: presentation,
  });

  assert.notEqual(step?.kind, "data");
  if (!step || step.kind === "data") return;
  assert.equal(step?.chip, "/workspace/thread.tsx");
  assert.equal(step?.presentation, presentation);
});

test("keeps the complete reasoning text for responsive collapsed previews", () => {
  assert.equal(
    reasoningPreview("First thought\n\nNewest   reasoning detail"),
    "First thought Newest reasoning detail",
  );
  assert.equal(reasoningPreview("123456789"), "123456789");
});

test("keeps the complete live reasoning text for end-anchored previews", () => {
  assert.equal(
    liveReasoningPreview("First thought\n\nNewest   reasoning detail"),
    "First thought Newest reasoning detail",
  );
  assert.equal(liveReasoningPreview("123456789"), "123456789");
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
          : entry.part.type === "data"
            ? "data"
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

test("does not report failed file mutations as successful changes", () => {
  assert.deepEqual(
    timelineStats([
      {
        ...tool("edit", {
          path: "/workspace/thread.tsx",
          edits: [{ oldText: "before", newText: "after" }],
        }),
        isError: true,
        result: "permission denied",
      },
      {
        ...tool("write", {
          path: "/workspace/new.tsx",
          content: "not written",
        }),
        isError: true,
        result: "disk full",
      },
    ]),
    [],
  );
});
