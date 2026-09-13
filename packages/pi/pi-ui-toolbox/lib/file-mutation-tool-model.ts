import {
  parseUnifiedPatch,
  visiblePatchHunks,
  type DiffHunk,
  type DiffLine,
  type ParsedPatchHunk,
} from "@workbench/code-highlighting";
import type { ToolCallBlock } from "@workbench/agent-runtime-contracts/conversation";
import type { ToolPresentationResourceStat } from "@workbench/extension-sdk";

export interface FileMutationToolCall {
  toolName: string;
  toolCallId: string;
  args: unknown;
  result?: unknown;
}

export interface FileMutationToolModel {
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

function firstString(value: Record<string, unknown> | undefined, ...keys: readonly string[]) {
  for (const key of keys) {
    const candidate = value?.[key];
    if (typeof candidate === "string") return candidate;
  }
  return undefined;
}

export function fileMutationBasename(path: string): string {
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

function hunkRange(oldStart: number, oldCount: number, newStart: number, newCount: number) {
  return `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
}

function reviewHunks(
  toolCallId: string,
  parsedHunks: readonly ParsedPatchHunk[],
): readonly DiffHunk[] {
  return visiblePatchHunks(parsedHunks).map((hunk) => ({
    id: `${toolCallId}:patch:${hunk.sourceHunkIndex}:${hunk.sourceBlockIndex}`,
    range: hunkRange(
      hunk.oldStart,
      hunk.lines.filter((line) => line.kind !== "added").length,
      hunk.newStart,
      hunk.lines.filter((line) => line.kind !== "removed").length,
    ),
    decision: "pending" as const,
    lines: hunk.lines,
    hiddenContextBefore: hunk.hiddenContextBefore,
    hiddenContextAfter: hunk.hiddenContextAfter,
  }));
}

function resultPatch(result: unknown): string | undefined {
  const value = asRecord(result);
  return firstString(asRecord(value?.details), "patch") ?? firstString(value, "patch");
}

function argumentHunks(part: FileMutationToolCall, args: Record<string, unknown>): DiffHunk[] {
  if (part.toolName === "write") {
    const lines: DiffLine[] = [];
    appendLines(lines, "added", firstString(args, "content", "contents", "text"));
    return lines.length
      ? [
          {
            id: `${part.toolCallId}:args:0`,
            range: hunkRange(0, 0, 1, lines.length),
            decision: "pending",
            lines,
          },
        ]
      : [];
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
    if (!lines.length) return [];
    return [
      {
        id: `${part.toolCallId}:args:${editIndex}`,
        range: hunkRange(
          1,
          lines.filter((line) => line.kind === "removed").length,
          1,
          lines.filter((line) => line.kind === "added").length,
        ),
        decision: "pending" as const,
        lines,
      },
    ];
  });
}

export function fileMutationToolModel(
  part: FileMutationToolCall,
): FileMutationToolModel | undefined {
  if (part.toolName !== "edit" && part.toolName !== "write") return undefined;
  const args = asRecord(part.args);
  const path = firstString(args, "path", "file", "filePath", "file_path")?.trim();
  if (!args || !path) return undefined;
  const parsedHunks = resultPatch(part.result) ? parseUnifiedPatch(resultPatch(part.result)!) : [];
  const hunks = parsedHunks.length
    ? reviewHunks(part.toolCallId, parsedHunks)
    : argumentHunks(part, args);
  const lines = parsedHunks.length
    ? parsedHunks.flatMap((hunk) => hunk.lines)
    : hunks.flatMap((hunk) => hunk.lines);
  return {
    toolCallId: part.toolCallId,
    path,
    filename: fileMutationBasename(path),
    additions: lines.filter((line) => line.kind === "added").length,
    deletions: lines.filter((line) => line.kind === "removed").length,
    lines,
    hunks,
  };
}

export function fileMutationResourceStats(
  block: ToolCallBlock,
): readonly ToolPresentationResourceStat[] {
  if (block.status !== "complete") return [];
  const model = fileMutationToolModel({
    toolName: block.toolName,
    toolCallId: block.callId,
    args: block.arguments,
    result: block.result,
  });
  if (!model) return [];
  return [
    {
      file: model.filename,
      ...(model.additions ? { added: model.additions } : {}),
      ...(model.deletions ? { removed: model.deletions } : {}),
    },
  ];
}
