import type {
  DataBlock,
  MessageBlock,
  ReasoningBlock,
  ToolCallBlock,
} from "@workbench/agent-runtime-contracts/conversation";

import type { LocalizableText } from "@workbench/i18n/runtime";
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

export function timelineBlockIsActive(
  block: TimelineSourceBlock,
  dataPresentations: Readonly<Record<string, DataPresentationDefinition>>,
): boolean {
  return block.kind === "data"
    ? dataTimelineState(block, dataPresentations)?.active === true
    : block.status === "running";
}

export function timelineHasActiveWork(
  blocks: readonly TimelineSourceBlock[],
  dataPresentations: Readonly<Record<string, DataPresentationDefinition>>,
  messageRunning = false,
): boolean {
  return messageRunning || blocks.some((block) => timelineBlockIsActive(block, dataPresentations));
}

export function hasTrailingTextBlock(
  blocks: readonly MessageBlock[],
  lastTimelineIndex: number | undefined,
): boolean {
  return (
    lastTimelineIndex !== undefined &&
    blocks.slice(lastTimelineIndex + 1).some((block) => block.kind === "text" && block.text.trim())
  );
}

export function compactTimelineText(value: string, maxLength = 68): string {
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

export function timelineEntries(
  blocks: readonly TimelineSourceBlock[],
  groupParallelTools = true,
  groups: {
    groupExplorationTools?: boolean;
    groupTerminalTools?: boolean;
    groupFileChanges?: boolean;
  } = {},
  presentations: Readonly<Record<string, ToolPresentationDefinition>> = {},
  node?: MessageBlockNode,
  resolvedPresentations?: readonly (ToolPresentationDefinition | undefined)[],
): ToolTimelineEntry[] {
  const entries: ToolTimelineEntry[] = [];

  blocks.forEach((block, sourceIndex) => {
    const presentation =
      resolvedPresentations?.[sourceIndex] ??
      (block.kind === "tool-call"
        ? resolveToolPresentation(
            block,
            Object.hasOwn(presentations, block.toolName)
              ? presentations[block.toolName]
              : undefined,
            node,
          )
        : undefined);
    const category = presentation?.group;
    const enabledCategory =
      category === "exploration" && groups.groupExplorationTools
        ? "exploration"
        : category === "terminal" && groups.groupTerminalTools
          ? "terminal"
          : category === "changes" && groups.groupFileChanges
            ? "changes"
            : undefined;
    const previous = entries.at(-1);
    const parallelId =
      groupParallelTools && block.kind === "tool-call" ? block.parallelGroup?.key : undefined;
    const batchId =
      parallelId ??
      (enabledCategory && block.kind === "tool-call"
        ? previous?.kind === "parallel-tools" && previous.category === enabledCategory
          ? previous.batchId
          : `category:${enabledCategory}:${block.callId}`
        : undefined);
    const groupedCategory = parallelId ? undefined : enabledCategory;
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
    if (typeof summary === "string") return compactTimelineText(summary);
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

  return compactTimelineText(block.toolName);
}

function toolKind(presentation?: ToolPresentationDefinition): ToolTimelineStepKind {
  if (presentation?.group === "exploration") return "searched";
  if (presentation?.group === "terminal") return "ran";
  if (presentation?.group === "changes") return "edited";
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
      kind: toolKind(presentation),
      chip: toolChip(block, presentation),
      ...(presentation ? { presentation } : {}),
    };
  });
}

export function timelineStats(
  blocks: readonly TimelineSourceBlock[],
  presentations: Readonly<Record<string, ToolPresentationDefinition>> = {},
  node?: MessageBlockNode,
  resolvedPresentations?: readonly (ToolPresentationDefinition | undefined)[],
): ToolTimelineStatModel[] {
  const stats = new Map<string, Required<Omit<ToolTimelineStatModel, "file">>>();

  for (const [index, block] of blocks.entries()) {
    if (block.kind !== "tool-call" || block.status !== "complete") {
      continue;
    }
    const presentation =
      resolvedPresentations?.[index] ??
      resolveToolPresentation(
        block,
        Object.hasOwn(presentations, block.toolName) ? presentations[block.toolName] : undefined,
        node,
      );
    let resources: readonly ToolTimelineStatModel[] = [];
    try {
      resources = presentation?.getResourceStats?.(block, node) ?? [];
    } catch {
      resources = [];
    }
    for (const resource of resources) {
      const current = stats.get(resource.file) ?? { added: 0, removed: 0 };
      current.added += resource.added ?? 0;
      current.removed += resource.removed ?? 0;
      stats.set(resource.file, current);
    }
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
