import type {
  DataBlock,
  ReasoningBlock,
  ToolCallBlock,
} from "@workbench/agent-runtime-contracts/conversation";

import type { LocalizableText } from "../../../i18n";
import type {
  DataPresentationDefinition,
  MessageBlockNode,
  ToolPresentationDefinition,
} from "@workbench/extension-sdk";

export type ToolTimelineStepKind = "thinking" | "read" | "ran" | "edited" | "searched" | "used";

export type ToolTimelineStepModel =
  | {
      kind: "data";
    }
  | {
      kind: ToolTimelineStepKind;
      chip: LocalizableText;
      presentation?: ToolPresentationDefinition;
    };

export interface ToolTimelineStatModel {
  file: string;
  added?: number;
  removed?: number;
}

export type TimelineSourceBlock = ReasoningBlock | ToolCallBlock | DataBlock;

export type ToolTimelineEntry =
  | {
      kind: "block";
      block: TimelineSourceBlock;
      sourceIndex: number;
    }
  | {
      kind: "parallel-tools";
      batchId: string;
      category?: "exploration" | "terminal" | "changes";
      blocks: readonly ToolCallBlock[];
      sourceIndices: readonly number[];
    };

export interface DataTimelineState {
  readonly active: boolean;
  readonly group?: NonNullable<DataPresentationDefinition["group"]> & {
    readonly key: string;
  };
}

export function dataTimelineState(
  block: DataBlock,
  presentations: Readonly<Record<string, DataPresentationDefinition>>,
): DataTimelineState | undefined {
  const presentation = Object.hasOwn(presentations, block.name)
    ? presentations[block.name]
    : undefined;
  if (!presentation || presentation.display !== "timeline") return undefined;
  try {
    if (presentation.isVisible && !presentation.isVisible(block)) return undefined;
  } catch {
    return undefined;
  }

  let active = false;
  try {
    active = presentation.isActive?.(block) === true;
  } catch {
    // Optional presentation chrome must not hide an otherwise valid data step.
  }

  try {
    const key = presentation.group?.getKey(block)?.trim();
    return {
      active,
      ...(key && presentation.group ? { group: { ...presentation.group, key } } : {}),
    };
  } catch {
    return { active };
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function compact(value: string, maxLength = 68): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export function reasoningPreview(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function liveReasoningPreview(value: string): string {
  return reasoningPreview(value);
}

export function activeToolPresentationLabel(
  block: ToolCallBlock,
  presentation: ToolPresentationDefinition | undefined,
): LocalizableText | undefined {
  if (!presentation) return undefined;
  if (!presentation.getActiveLabel) return presentation.activeLabel;

  try {
    const activeLabel = presentation.getActiveLabel(block);
    if (activeLabel === undefined) return presentation.activeLabel;
    return activeLabel;
  } catch {
    return presentation.activeLabel;
  }
}

function resolveToolPresentation(
  block: ToolCallBlock,
  presentation: ToolPresentationDefinition | undefined,
  node?: MessageBlockNode,
): ToolPresentationDefinition | undefined {
  try {
    return presentation?.resolve?.(block, node) ?? presentation;
  } catch {
    return presentation;
  }
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function lineCount(value: string | undefined): number {
  if (!value) return 0;
  return value.replace(/\n$/, "").split("\n").length;
}

function firstString(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.find((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function timelineEntries(
  blocks: readonly TimelineSourceBlock[],
  groupParallelTools = true,
  groups: {
    groupExplorationTools?: boolean;
    groupTerminalTools?: boolean;
    groupFileChanges?: boolean;
  } = {},
): ToolTimelineEntry[] {
  const entries: ToolTimelineEntry[] = [];

  blocks.forEach((block, sourceIndex) => {
    const kind = block.kind === "tool-call" ? toolKind(block.toolName) : undefined;
    const category =
      (kind === "read" || kind === "searched") && groups.groupExplorationTools
        ? "exploration"
        : kind === "ran" && groups.groupTerminalTools
          ? "terminal"
          : kind === "edited" && groups.groupFileChanges
            ? "changes"
            : undefined;
    const previous = entries.at(-1);
    const parallelId =
      groupParallelTools && block.kind === "tool-call" ? block.parallelGroup?.key : undefined;
    const batchId =
      parallelId ??
      (category && block.kind === "tool-call"
        ? previous?.kind === "parallel-tools" && previous.category === category
          ? previous.batchId
          : `category:${category}:${block.callId}`
        : undefined);
    const groupedCategory = parallelId ? undefined : category;
    if (!batchId || block.kind !== "tool-call") {
      entries.push({ kind: "block", block, sourceIndex });
      return;
    }

    if (previous?.kind === "parallel-tools" && previous.batchId === batchId) {
      entries[entries.length - 1] = {
        ...previous,
        blocks: [...previous.blocks, block],
        sourceIndices: [...previous.sourceIndices, sourceIndex],
      };
      return;
    }

    entries.push({
      kind: "parallel-tools",
      batchId,
      ...(groupedCategory ? { category: groupedCategory } : {}),
      blocks: [block],
      sourceIndices: [sourceIndex],
    });
  });

  return entries.map((entry) =>
    entry.kind === "parallel-tools" && entry.category && entry.blocks.length === 1
      ? { kind: "block", block: entry.blocks[0]!, sourceIndex: entry.sourceIndices[0]! }
      : entry,
  );
}

function registeredToolChip(
  block: ToolCallBlock,
  presentation: ToolPresentationDefinition | undefined,
): LocalizableText | undefined {
  if (!presentation?.summarize) return undefined;

  try {
    const summary = presentation.summarize(block);
    if (typeof summary === "string") return compact(summary);
    return summary;
  } catch {
    // A presentation is optional chrome. Keep the message readable if an extension summary fails.
    return undefined;
  }
}

function toolChip(
  block: ToolCallBlock,
  presentation?: ToolPresentationDefinition,
): LocalizableText {
  const registeredSummary = registeredToolChip(block, presentation);
  if (registeredSummary !== undefined) return registeredSummary;

  const args = asRecord(block.arguments);
  const path = asString(args?.path) ?? asString(args?.file) ?? asString(args?.filePath);

  switch (block.toolName) {
    case "bash":
      return normalize(asString(args?.command) ?? block.toolName);
    case "read":
    case "write":
    case "edit":
      return compact(path ? fileName(path) : block.toolName);
    case "web_crawl":
      return compact(firstString(args?.start_urls) ?? asString(args?.url) ?? block.toolName);
    default:
      return compact(
        path ??
          asString(args?.query) ??
          asString(args?.pattern) ??
          asString(args?.command) ??
          block.toolName,
      );
  }
}

function toolKind(toolName: string): ToolTimelineStepKind {
  if (toolName === "bash") return "ran";
  if (toolName === "read") return "read";
  if (toolName === "edit" || toolName === "write" || toolName === "apply_patch") {
    return "edited";
  }
  if (toolName === "web_crawl" || /(?:search|grep|find)/i.test(toolName)) return "searched";
  return "used";
}

export function timelineSteps(
  blocks: readonly TimelineSourceBlock[],
  presentations: Readonly<Record<string, ToolPresentationDefinition>> = {},
  node?: MessageBlockNode,
): ToolTimelineStepModel[] {
  return blocks.map((block): ToolTimelineStepModel => {
    if (block.kind === "data") return { kind: "data" };

    if (block.kind === "reasoning") {
      const chip = reasoningPreview(block.text) || "…";
      return { kind: "thinking", chip };
    }

    const registered = Object.hasOwn(presentations, block.toolName)
      ? presentations[block.toolName]
      : undefined;
    const presentation = resolveToolPresentation(block, registered, node);
    return {
      kind: toolKind(block.toolName),
      chip: toolChip(block, presentation),
      ...(presentation ? { presentation } : {}),
    };
  });
}

export function timelineStats(blocks: readonly TimelineSourceBlock[]): ToolTimelineStatModel[] {
  const stats = new Map<string, Required<Omit<ToolTimelineStatModel, "file">>>();

  for (const block of blocks) {
    if (block.kind !== "tool-call" || block.status === "error" || block.status === "incomplete") {
      continue;
    }
    const args = asRecord(block.arguments);
    const path = asString(args?.path) ?? asString(args?.file) ?? asString(args?.filePath);
    if (!path || (block.toolName !== "edit" && block.toolName !== "write")) continue;

    const file = fileName(path);
    const current = stats.get(file) ?? { added: 0, removed: 0 };

    if (block.toolName === "write") {
      current.added += lineCount(asString(args?.content));
    } else if (Array.isArray(args?.edits)) {
      for (const candidate of args.edits) {
        const edit = asRecord(candidate);
        current.added += lineCount(asString(edit?.newText));
        current.removed += lineCount(asString(edit?.oldText));
      }
    }

    stats.set(file, current);
  }

  return [...stats].map(([file, counts]) => ({
    file,
    ...(counts.added > 0 ? { added: counts.added } : {}),
    ...(counts.removed > 0 ? { removed: counts.removed } : {}),
  }));
}

export function toolTimelineCallState(block: ToolCallBlock) {
  const cancelled = block.status === "incomplete" && block.incompleteReason === "cancelled";
  return {
    running: block.status === "running",
    requiresAction: block.status === "requires-action",
    failed: block.status === "error" || (block.status === "incomplete" && !cancelled),
    cancelled,
    request: block.argumentsText,
    result: block.error?.message ?? block.result,
  };
}
