import type { ReasoningMessagePart, ToolCallMessagePart } from "@assistant-ui/react";

export type ToolTimelineStepKind = "thinking" | "read" | "ran" | "edited" | "searched" | "used";

export interface ToolTimelineStepModel {
  kind: ToolTimelineStepKind;
  chip: string;
}

export interface ToolTimelineStatModel {
  file: string;
  added?: number;
  removed?: number;
}

type TimelineSourcePart = ReasoningMessagePart | ToolCallMessagePart;

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

export function latestReasoningPreview(value: string, maxLength = 68): string {
  const withoutTrailingWhitespace = value.trimEnd();
  const latestLineStart = withoutTrailingWhitespace.lastIndexOf("\n") + 1;
  const latest = withoutTrailingWhitespace.slice(latestLineStart).replace(/\s+/g, " ").trim();

  if (!latest) return "";
  if (latest.length <= maxLength) return latest;
  return `…${latest.slice(-(maxLength - 1)).trimStart()}`;
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

function toolChip(part: ToolCallMessagePart): string {
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

export function timelineSteps(parts: readonly TimelineSourcePart[]): ToolTimelineStepModel[] {
  return parts.flatMap((part) => {
    if (part.type === "reasoning") {
      const chip = latestReasoningPreview(part.text || part.unstable_summary || "") || "…";
      return [{ kind: "thinking" as const, chip }];
    }

    return [{ kind: toolKind(part.toolName), chip: toolChip(part) }];
  });
}

export function timelineStats(parts: readonly TimelineSourcePart[]): ToolTimelineStatModel[] {
  const stats = new Map<string, Required<Omit<ToolTimelineStatModel, "file">>>();

  for (const part of parts) {
    if (part.type !== "tool-call") continue;
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
