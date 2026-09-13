import { defineBrowserMessage } from "@workbench/workspace-browser/i18n";
import assert from "node:assert/strict";
import test from "node:test";

import { WrenchIcon } from "lucide-react";
import type {
  AssistantMessageNode,
  DataBlock,
  ReasoningBlock,
  ToolCallBlock,
} from "@workbench/agent-runtime-contracts/conversation";

import { defineMessage } from "@workbench/ui-settings-archived-chats/i18n";
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
} from "../lib/tool-timeline-model";

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

function presentation(
  group: NonNullable<ToolPresentationDefinition["group"]>,
  summarize?: ToolPresentationDefinition["summarize"],
  getResourceStats?: ToolPresentationDefinition["getResourceStats"],
): ToolPresentationDefinition {
  return {
    label: "Complete",
    activeLabel: "Active",
    icon: WrenchIcon,
    group,
    ...(summarize ? { summarize } : {}),
    ...(getResourceStats ? { getResourceStats } : {}),
  };
}

const categoryPresentations = {
  read: presentation("exploration"),
  grep: presentation("exploration"),
  search: presentation("exploration"),
  bash: presentation("terminal"),
  write: presentation("changes"),
  edit: presentation("changes"),
};

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
  const entries = timelineEntries(
    blocks,
    true,
    { groupExplorationTools: true, groupTerminalTools: true, groupFileChanges: true },
    categoryPresentations,
  );
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
    timelineEntries(
      [tool("read", {})],
      true,
      { groupExplorationTools: true },
      categoryPresentations,
    )[0]?.kind,
    "block",
  );
  const parallel = blocks
    .slice(0, 2)
    .map((block) => ({ ...block, parallelGroup: { key: "parallel", size: 2 } }));
  const grouped = timelineEntries(
    parallel,
    true,
    { groupExplorationTools: true },
    categoryPresentations,
  );
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

test("maps tools only through explicit presentations and leaves unregistered tools generic", () => {
  const reasoning = {
    key: "reasoning-block",
    kind: "reasoning",
    text: "Planning the change",
  } satisfies ReasoningBlock;

  assert.deepEqual(
    timelineSteps(
      [
        reasoning,
        tool("read", { path: "/workspace/thread.tsx" }),
        tool("bash", { command: "pnpm vitest" }),
        tool("edit", { path: "/workspace/composer.tsx", edits: [] }),
        tool("web_crawl", { start_urls: ["https://example.com/docs"] }),
      ],
      {
        read: presentation("exploration", (block) =>
          (block.arguments as { path: string }).path.split("/").at(-1),
        ),
        bash: presentation("terminal", (block) => (block.arguments as { command: string }).command),
        edit: presentation("changes", (block) =>
          (block.arguments as { path: string }).path.split("/").at(-1),
        ),
      },
    ).map((step) => (step.kind === "data" ? step : { kind: step.kind, chip: step.chip })),
    [
      { kind: "thinking", chip: "Planning the change" },
      { kind: "searched", chip: "thread.tsx" },
      { kind: "ran", chip: "pnpm vitest" },
      { kind: "edited", chip: "composer.tsx" },
      { kind: "used", chip: "web_crawl" },
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
  const progress = data("workbench.progress", { status: "succeeded" });
  const blocks = [
    {
      key: "reasoning-block",
      kind: "reasoning",
      text: "Inspect the request",
    } satisfies ReasoningBlock,
    progress,
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
    ["reasoning", "workbench.progress", "read"],
  );
  assert.deepEqual(
    timelineSteps(blocks).map((step) => step.kind),
    ["thinking", "data", "used"],
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
    group: "exploration",
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
    { kind: "searched", chip: "", presentation: resolved },
  ]);
  for (const resolve of [
    () => undefined,
    () => {
      throw new Error("broken resolver");
    },
  ]) {
    const fallback = { ...presentation, resolve };
    assert.deepEqual(timelineSteps([block], { read: fallback }, node), [
      { kind: "used", chip: "read", presentation: fallback },
    ]);
  }
});

test("resolves a stream-safe active label from partial tool arguments", () => {
  const block = tool("ask_user", { questions: [{ id: "partial" }] });
  const presentation = {
    label: "Asked user",
    activeLabel: "Asking user",
    getActiveLabel: () => defineBrowserMessage("extensions.workspaceBrowser.navigateFailed"),
    icon: WrenchIcon,
  } satisfies ToolPresentationDefinition;

  assert.deepEqual(
    activeToolPresentationLabel(block, presentation),
    defineBrowserMessage("extensions.workspaceBrowser.navigateFailed"),
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
  assert.equal(step?.chip, "inspect");
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
    timelineStats(
      [
        tool("edit", {
          path: "/workspace/thread.tsx",
          edits: [{ oldText: "old one\nold two", newText: "new one\nnew two\nnew three" }],
        }),
        tool("write", {
          path: "/workspace/thread.tsx",
          content: "appended one\nappended two\n",
        }),
        tool("read", { path: "/workspace/ignored.tsx" }),
      ],
      {
        edit: presentation("changes", undefined, () => [
          { file: "thread.tsx", added: 3, removed: 2 },
        ]),
        write: presentation("changes", undefined, () => [{ file: "thread.tsx", added: 2 }]),
      },
    ),
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

test("isolates resource-stat failures and keeps basename entries distinct by contribution output", () => {
  const broken = presentation("changes", undefined, () => {
    throw new Error("broken stats");
  });
  const explicit = presentation("changes", undefined, () => [
    { file: "same.ts", added: 2 },
    { file: "same.ts", removed: 1 },
  ]);
  assert.deepEqual(timelineStats([tool("broken", {})], { broken }), []);
  assert.deepEqual(timelineStats([tool("explicit", {})], { explicit }), [
    { file: "same.ts", added: 2, removed: 1 },
  ]);
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
