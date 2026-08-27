import type {
  DataMessagePart,
  ReasoningMessagePart,
  ToolCallMessagePart,
} from "@assistant-ui/react";

import type { LocalizableText } from "@/i18n";
import type { DataPresentationDefinition, ToolPresentationDefinition } from "@/platform/extensions";

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

export type TimelineSourcePart = ReasoningMessagePart | ToolCallMessagePart | DataMessagePart;

export type ToolTimelineEntry =
  | {
      kind: "part";
      part: TimelineSourcePart;
      sourceIndex: number;
    }
  | {
      kind: "parallel-tools";
      batchId: string;
      parts: readonly ToolCallMessagePart[];
      sourceIndices: readonly number[];
    };

export interface DataTimelineState {
  readonly active: boolean;
}

export function dataTimelineState(
  part: DataMessagePart,
  presentations: Readonly<Record<string, DataPresentationDefinition>>,
): DataTimelineState | undefined {
  const presentation = Object.hasOwn(presentations, part.name)
    ? presentations[part.name]
    : undefined;
  if (!presentation || presentation.display !== "timeline") return undefined;

  try {
    if (presentation.isVisible && !presentation.isVisible(part)) return undefined;
  } catch {
    return undefined;
  }

  try {
    return { active: presentation.isActive?.(part) === true };
  } catch {
    return { active: false };
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

export function reasoningPartTiming(
  part: ReasoningMessagePart,
): ToolCallMessagePart["timing"] | undefined {
  const pi = asRecord(part.providerMetadata?.pi);
  const startedAt = pi?.startedAt;
  const durationMs = pi?.durationMs;
  const validStartedAt =
    typeof startedAt === "number" && Number.isFinite(startedAt) ? startedAt : undefined;
  const validDuration =
    typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0
      ? durationMs
      : undefined;

  if (validDuration !== undefined) {
    const normalizedStart = validStartedAt ?? 0;
    return { startedAt: normalizedStart, completedAt: normalizedStart + validDuration };
  }
  return validStartedAt === undefined ? undefined : { startedAt: validStartedAt };
}

export function activeToolPresentationLabel(
  part: ToolCallMessagePart,
  presentation: ToolPresentationDefinition | undefined,
): LocalizableText | undefined {
  if (!presentation) return undefined;
  if (!presentation.getActiveLabel) return presentation.activeLabel;

  try {
    const activeLabel = presentation.getActiveLabel(part);
    if (activeLabel === undefined) return presentation.activeLabel;
    return activeLabel;
  } catch {
    return presentation.activeLabel;
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

function parallelToolBatchId(part: ToolCallMessagePart): string | undefined {
  const pi = asRecord(part.providerMetadata?.pi);
  const batchId = asString(pi?.parallelToolBatchId);
  const batchSize = pi?.parallelToolBatchSize;
  return batchId && typeof batchSize === "number" && batchSize > 1 ? batchId : undefined;
}

export function timelineEntries(parts: readonly TimelineSourcePart[]): ToolTimelineEntry[] {
  const entries: ToolTimelineEntry[] = [];

  parts.forEach((part, sourceIndex) => {
    const batchId = part.type === "tool-call" ? parallelToolBatchId(part) : undefined;
    if (!batchId || part.type !== "tool-call") {
      entries.push({ kind: "part", part, sourceIndex });
      return;
    }

    const previous = entries.at(-1);
    if (previous?.kind === "parallel-tools" && previous.batchId === batchId) {
      entries[entries.length - 1] = {
        ...previous,
        parts: [...previous.parts, part],
        sourceIndices: [...previous.sourceIndices, sourceIndex],
      };
      return;
    }

    entries.push({
      kind: "parallel-tools",
      batchId,
      parts: [part],
      sourceIndices: [sourceIndex],
    });
  });

  return entries;
}

function registeredToolChip(
  part: ToolCallMessagePart,
  presentation: ToolPresentationDefinition | undefined,
): LocalizableText | undefined {
  if (!presentation?.summarize) return undefined;

  try {
    const summary = presentation.summarize(part);
    if (typeof summary === "string") return summary.trim() ? compact(summary) : undefined;
    return summary;
  } catch {
    // A presentation is optional chrome. Keep the message readable if an extension summary fails.
    return undefined;
  }
}

function toolChip(
  part: ToolCallMessagePart,
  presentation?: ToolPresentationDefinition,
): LocalizableText {
  const registeredSummary = registeredToolChip(part, presentation);
  if (registeredSummary) return registeredSummary;

  const args = asRecord(part.args);
  const path = asString(args?.path) ?? asString(args?.file) ?? asString(args?.filePath);

  switch (part.toolName) {
    case "bash":
      return normalize(asString(args?.command) ?? part.toolName);
    case "read":
    case "write":
    case "edit":
      return compact(path ? fileName(path) : part.toolName);
    case "web_crawl":
      return compact(firstString(args?.start_urls) ?? asString(args?.url) ?? part.toolName);
    default:
      return compact(
        path ??
          asString(args?.query) ??
          asString(args?.pattern) ??
          asString(args?.command) ??
          part.toolName,
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
  parts: readonly TimelineSourcePart[],
  presentations: Readonly<Record<string, ToolPresentationDefinition>> = {},
): ToolTimelineStepModel[] {
  return parts.map((part): ToolTimelineStepModel => {
    if (part.type === "data") return { kind: "data" };

    if (part.type === "reasoning") {
      const chip = reasoningPreview(part.text || part.unstable_summary || "") || "…";
      return { kind: "thinking", chip };
    }

    const presentation = Object.hasOwn(presentations, part.toolName)
      ? presentations[part.toolName]
      : undefined;
    return {
      kind: toolKind(part.toolName),
      chip: toolChip(part, presentation),
      ...(presentation ? { presentation } : {}),
    };
  });
}

export function timelineStats(parts: readonly TimelineSourcePart[]): ToolTimelineStatModel[] {
  const stats = new Map<string, Required<Omit<ToolTimelineStatModel, "file">>>();

  for (const part of parts) {
    if (part.type !== "tool-call" || part.isError) continue;
    const args = asRecord(part.args);
    const path = asString(args?.path) ?? asString(args?.file) ?? asString(args?.filePath);
    if (!path || (part.toolName !== "edit" && part.toolName !== "write")) continue;

    const file = fileName(path);
    const current = stats.get(file) ?? { added: 0, removed: 0 };

    if (part.toolName === "write") {
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
