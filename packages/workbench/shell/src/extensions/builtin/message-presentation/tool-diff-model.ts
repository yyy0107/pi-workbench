import {
  parseUnifiedPatch,
  visiblePatchHunks,
  type ParsedPatchHunk,
} from "../../../elements/unified-patch";
import type { DiffLine } from "../../../elements/code-diff";
import type { DiffHunk } from "../../../elements/reviewable-diff";

export interface FileMutationToolCall {
  toolName: string;
  toolCallId: string;
  args: unknown;
  result?: unknown;
}

export interface ToolDiffModel {
  toolCallId: string;
  path: string;
  filename: string;
  additions: number;
  deletions: number;
  lines: readonly DiffLine[];
  hunks: readonly DiffHunk[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstString(
  value: Record<string, unknown> | undefined,
  ...keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const candidate = value?.[key];
    if (typeof candidate === "string") return candidate;
  }
  return undefined;
}

function pathName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function textLines(value: string | undefined): readonly string[] {
  if (value === undefined || value.length === 0) return [];
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function appendLines(target: DiffLine[], kind: DiffLine["kind"], value: string | undefined) {
  for (const text of textLines(value)) target.push({ kind, text });
}

function unifiedRange(start: number, count: number): string {
  return `${start},${count}`;
}

function hunkRange(oldStart: number, oldCount: number, newStart: number, newCount: number): string {
  return `@@ -${unifiedRange(oldStart, oldCount)} +${unifiedRange(newStart, newCount)} @@`;
}

function reviewHunks(
  toolCallId: string,
  parsedHunks: readonly ParsedPatchHunk[],
): readonly DiffHunk[] {
  return visiblePatchHunks(parsedHunks).map((hunk) => {
    const oldCount = hunk.lines.filter((line) => line.kind !== "added").length;
    const newCount = hunk.lines.filter((line) => line.kind !== "removed").length;

    return {
      id: `${toolCallId}:patch:${hunk.sourceHunkIndex}:${hunk.sourceBlockIndex}`,
      range: hunkRange(hunk.oldStart, oldCount, hunk.newStart, newCount),
      decision: "pending" as const,
      lines: hunk.lines,
      hiddenContextBefore: hunk.hiddenContextBefore,
      hiddenContextAfter: hunk.hiddenContextAfter,
    };
  });
}

function resultPatch(result: unknown): string | undefined {
  const value = asRecord(result);
  const details = asRecord(value?.details);
  return firstString(details, "patch") ?? firstString(value, "patch");
}

function argumentHunks(part: FileMutationToolCall, args: Record<string, unknown>): DiffHunk[] {
  if (part.toolName === "write") {
    const lines: DiffLine[] = [];
    appendLines(lines, "added", firstString(args, "content", "contents", "text"));
    if (lines.length === 0) return [];
    return [
      {
        id: `${part.toolCallId}:args:0`,
        range: hunkRange(0, 0, 1, lines.length),
        decision: "pending",
        lines,
      },
    ];
  }

  const candidates = Array.isArray(args.edits) ? args.edits : [args];
  return candidates.flatMap((candidate, editIndex) => {
    const edit = asRecord(candidate);
    const lines: DiffLine[] = [];
    appendLines(
      lines,
      "removed",
      firstString(edit, "oldText", "old_text", "oldString", "old_string"),
    );
    appendLines(
      lines,
      "added",
      firstString(edit, "newText", "new_text", "newString", "new_string"),
    );
    if (lines.length === 0) return [];

    const oldCount = lines.filter((line) => line.kind === "removed").length;
    const newCount = lines.filter((line) => line.kind === "added").length;
    return [
      {
        id: `${part.toolCallId}:args:${editIndex}`,
        range: hunkRange(1, oldCount, 1, newCount),
        decision: "pending" as const,
        lines,
      },
    ];
  });
}

export function toolDiffModel(part: FileMutationToolCall): ToolDiffModel | undefined {
  if (part.toolName !== "edit" && part.toolName !== "write") return undefined;

  const args = asRecord(part.args);
  if (!args) return undefined;
  const path = firstString(args, "path", "file", "filePath", "file_path")?.trim();
  if (!path) return undefined;

  const patch = resultPatch(part.result);
  const parsedHunks = patch ? parseUnifiedPatch(patch) : [];
  const hunks =
    parsedHunks.length > 0 ? reviewHunks(part.toolCallId, parsedHunks) : argumentHunks(part, args);
  const lines =
    parsedHunks.length > 0
      ? parsedHunks.flatMap((hunk) => hunk.lines)
      : hunks.flatMap((hunk) => hunk.lines);

  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.kind === "added") additions += 1;
    if (line.kind === "removed") deletions += 1;
  }

  return {
    toolCallId: part.toolCallId,
    path,
    filename: pathName(path),
    additions,
    deletions,
    lines,
    hunks,
  };
}
