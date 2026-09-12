import assert from "node:assert/strict";
import test from "node:test";

import { WrenchIcon } from "lucide-react";
import type {
  AssistantMessageNode,
  DataBlock,
  ReasoningBlock,
  ToolCallBlock,
} from "@workbench/agent-runtime-contracts/conversation";

import { defineMessage } from "../../../i18n";
import type {
  DataPresentationDefinition,
  ToolPresentationDefinition,
} from "@workbench/extension-sdk";
import {
  type TimelineSourceBlock,
  activeToolPresentationLabel,
  compactTimelineText,
  dataTimelineState,
  hasTrailingTextBlock,
  liveReasoningPreview,
  reasoningPreview,
  timelineBlockIsActive,
  timelineEntries,
  timelineHasActiveWork,
  timelineStats,
  timelineSteps,
  toolTimelineCallState,
} from "./tool-timeline-model";

function tool(toolName: string, args: Record<string, unknown>): ToolCallBlock {
  return {
    key: `${toolName}-block`,
    kind: "tool-call",
    callId: `${toolName}-call`,
    toolName,
    arguments: args as ToolCallBlock["arguments"],
    argumentsText: JSON.stringify(args),
    status: "complete",
  };
}

function data(name: string, value: DataBlock["data"]): DataBlock {
  return { key: `${name}-block`, kind: "data", name, data: value };
}

test("groups consecutive categories, preserves boundaries and prioritizes explicit parallel batches", () => {
  const blocks = [
    tool("read", {}),
    tool("grep", {}),
    data("boundary", {}),
    tool("bash", {}),
    tool("bash", {}),
    tool("write", {}),
    tool("edit", {}),
  ];
  const entries = timelineEntries(blocks, true, {
    groupExplorationTools: true,
    groupTerminalTools: true,
    groupFileChanges: true,
  });
  assert.deepEqual(
    entries.map((entry) => (entry.kind === "parallel-tools" ? entry.category : entry.kind)),
    ["exploration", "block", "terminal", "changes"],
  );
  assert.deepEqual(
    entries.flatMap<TimelineSourceBlock>((entry) =>
      entry.kind === "block" ? [entry.block] : entry.blocks,
    ),
    blocks,
  );
  assert.equal(
    timelineEntries([tool("read", {})], true, { groupExplorationTools: true })[0]?.kind,
    "block",
  );
  const parallel = blocks
    .slice(0, 2)
    .map((block) => ({ ...block, parallelGroup: { key: "parallel", size: 2 } }));
  const grouped = timelineEntries(parallel, true, { groupExplorationTools: true });
  assert.equal(grouped[0]?.kind === "parallel-tools" && grouped[0].category, undefined);
});

test("can display parallel tool calls separately without losing their order", () => {
  const blocks = [tool("read", { path: "a.ts" }), tool("read", { path: "b.ts" })].map((block) => ({
    ...block,
    parallelGroup: { key: "batch", size: 2 },
  }));
  assert.equal(timelineEntries(blocks).length, 1);
  assert.deepEqual(
    timelineEntries(blocks, false).map((entry) => entry.kind),
    ["block", "block"],
  );
  assert.deepEqual(
    timelineEntries(blocks, false).flatMap((entry) =>
      entry.kind === "block" ? [entry.block] : [],
    ),
    blocks,
  );
});

test("maps reasoning and common Pi tools to compact timeline steps", () => {
  const reasoning = {
    key: "reasoning-block",
    kind: "reasoning",
    text: "Planning the change",
  } satisfies ReasoningBlock;

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

test("admits only Data Blocks that opt into the shared work timeline", () => {
  const presentations = {
    "workbench.progress": {
      display: "timeline",
      isVisible: (block) => block.data !== "hidden",
      isActive: (block) => block.data === "running",
      group: {
        getKey: () => "context-1",
        label: "Context composed",
        activeLabel: "Composing context",
        icon: WrenchIcon,
      },
    },
  } satisfies Readonly<Record<string, DataPresentationDefinition>>;

  const runningState = dataTimelineState(data("workbench.progress", "running"), presentations);
  assert.equal(runningState?.active, true);
  assert.equal(runningState?.group?.key, "context-1");
  assert.equal(runningState?.group?.label, "Context composed");
  assert.equal(
    dataTimelineState(data("workbench.progress", "complete"), presentations)?.active,
    false,
  );
  assert.equal(dataTimelineState(data("workbench.progress", "hidden"), presentations), undefined);
  assert.equal(dataTimelineState(data("unregistered", "running"), presentations), undefined);
  assert.deepEqual(timelineSteps([data("workbench.progress", "complete")]), [{ kind: "data" }]);
});

test("keeps the timeline active between completed tool calls in a running assistant message", () => {
  const completeTool = tool("bash", { command: "echo A" });
  const runningTool = { ...completeTool, status: "running" } satisfies ToolCallBlock;

  assert.equal(timelineBlockIsActive(completeTool, {}), false);
  assert.equal(timelineBlockIsActive(runningTool, {}), true);
  assert.equal(timelineHasActiveWork([completeTool], {}, true), true);
  assert.equal(timelineHasActiveWork([completeTool], {}, false), false);
});

test("treats trailing assistant text as the end of the tool timeline", () => {
  const completeTool = tool("bash", { command: "echo A" });
  const textBlock = { key: "answer", kind: "text", text: "The result is ready." } as const;

  assert.equal(hasTrailingTextBlock([completeTool, textBlock], 0), true);
  assert.equal(hasTrailingTextBlock([completeTool, { ...textBlock, text: "  " }], 0), false);
  assert.equal(hasTrailingTextBlock([textBlock, completeTool], 0), false);
  assert.equal(hasTrailingTextBlock([textBlock], undefined), false);
});

test("keeps a data step in sequence with reasoning and tools", () => {
  const recognition = data("workbench.image-recognition", { status: "succeeded" });
  const blocks = [
    {
      key: "reasoning-block",
      kind: "reasoning",
      text: "Inspect the request",
    } satisfies ReasoningBlock,
    recognition,
    tool("read", { path: "/workspace/result.ts" }),
  ];

  assert.deepEqual(
    timelineEntries(blocks).map((entry) =>
      entry.kind === "block"
        ? entry.block.kind === "data"
          ? entry.block.name
          : entry.block.kind === "reasoning"
            ? "reasoning"
            : entry.block.toolName
        : entry.batchId,
    ),
    ["reasoning", "workbench.image-recognition", "read"],
  );
  assert.deepEqual(
    timelineSteps(blocks).map((step) => step.kind),
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
    summarize: (block) => {
      const args = block.arguments as { environment?: unknown };
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
  const summary = defineMessage("extensions.archivedChats.totalCount", {
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

test("resolves the current tool row with its owning message and preserves explicit empty summaries", () => {
  const block = tool("read", { path: "/skills/review/SKILL.md" });
  const node: AssistantMessageNode = {
    kind: "assistant",
    key: "assistant",
    status: "running",
    blocks: [block],
  };
  const resolved: ToolPresentationDefinition = {
    label: "Read review skill",
    activeLabel: "Reading review skill",
    icon: WrenchIcon,
    compact: true,
    summarize: () => "",
  };
  const presentation: ToolPresentationDefinition = {
    label: "Read",
    activeLabel: "Reading",
    icon: WrenchIcon,
    resolve(call, owner) {
      assert.equal(call, block);
      assert.equal(owner, node);
      return resolved;
    },
  };
  assert.deepEqual(timelineSteps([block], { read: presentation }, node), [
    { kind: "read", chip: "", presentation: resolved },
  ]);
  for (const resolve of [
    () => undefined,
    () => {
      throw new Error("broken resolver");
    },
  ]) {
    const fallback = { ...presentation, resolve };
    assert.deepEqual(timelineSteps([block], { read: fallback }, node), [
      { kind: "read", chip: "SKILL.md", presentation: fallback },
    ]);
  }
});

test("resolves a stream-safe active label from partial tool arguments", () => {
  const block = tool("ask_user", { questions: [{ id: "partial" }] });
  const presentation = {
    label: "Asked user",
    activeLabel: "Asking user",
    getActiveLabel: () => defineMessage("extensions.workspaceBrowser.navigateFailed"),
    icon: WrenchIcon,
  } satisfies ToolPresentationDefinition;

  assert.deepEqual(
    activeToolPresentationLabel(block, presentation),
    defineMessage("extensions.workspaceBrowser.navigateFailed"),
  );
  assert.equal(
    activeToolPresentationLabel(block, {
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

test("compacts the latest timeline activity without changing its readable prefix", () => {
  assert.equal(compactTimelineText("  Running\n  pnpm   test  "), "Running pnpm test");
  assert.equal(compactTimelineText("123456789", 8), "1234567…");
});

test("groups only adjacent tools carrying the same parallel batch metadata", () => {
  const parallelTool = (toolName: string, batchId: string): ToolCallBlock => ({
    ...tool(toolName, {}),
    parallelGroup: { key: batchId, size: 2 },
  });
  const reasoning = {
    key: "reasoning-block",
    kind: "reasoning",
    text: "Plan",
  } satisfies ReasoningBlock;

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
      entry.kind === "block"
        ? entry.block.kind === "reasoning"
          ? "reasoning"
          : entry.block.kind === "data"
            ? "data"
            : entry.block.toolName
        : `${entry.batchId}:${entry.blocks.map((block) => block.toolName).join(",")}`,
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

test("does not report failed or cancelled file mutations as successful changes", () => {
  assert.deepEqual(
    timelineStats([
      {
        ...tool("edit", {
          path: "/workspace/thread.tsx",
          edits: [{ oldText: "before", newText: "after" }],
        }),
        status: "error",
        result: "permission denied",
      },
      {
        ...tool("write", {
          path: "/workspace/new.tsx",
          content: "not written",
        }),
        status: "error",
        result: "disk full",
      },
      {
        ...tool("write", {
          path: "/workspace/cancelled.tsx",
          content: "not written",
        }),
        status: "incomplete",
        incompleteReason: "cancelled",
        result: "Operation aborted",
      },
    ]),
    [],
  );
});

test("keeps partial arguments and maps every Workbench tool status", () => {
  const partial = {
    ...tool("search", { query: "hel" }),
    argumentsText: '{"query":"hel',
    status: "running",
  } satisfies ToolCallBlock;

  assert.deepEqual(toolTimelineCallState(partial), {
    running: true,
    requiresAction: false,
    failed: false,
    cancelled: false,
    request: '{"query":"hel',
    result: undefined,
  });
  assert.equal(toolTimelineCallState({ ...partial, status: "complete" }).running, false);
  assert.equal(toolTimelineCallState({ ...partial, status: "error" }).failed, true);
  assert.equal(
    toolTimelineCallState({ ...partial, status: "requires-action" }).requiresAction,
    true,
  );
});
