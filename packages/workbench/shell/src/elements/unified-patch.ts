import type { DiffLine } from "./code-diff";

export interface ParsedPatchHunk {
  oldStart: number;
  newStart: number;
  lines: readonly DiffLine[];
}

export function parseUnifiedPatch(patch: string): readonly ParsedPatchHunk[] {
  const hunks: ParsedPatchHunk[] = [];
  let current: { oldStart: number; newStart: number; lines: DiffLine[] } | undefined;
  const headerPattern = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

  for (const rawLine of patch.replace(/\r\n?/g, "\n").split("\n")) {
    const header = headerPattern.exec(rawLine);
    if (header) {
      if (current) hunks.push(current);
      current = {
        oldStart: Number(header[1]),
        newStart: Number(header[2]),
        lines: [],
      };
      continue;
    }
    if (!current) continue;

    const marker = rawLine[0];
    if (marker === " ") current.lines.push({ kind: "context", text: rawLine.slice(1) });
    if (marker === "+") current.lines.push({ kind: "added", text: rawLine.slice(1) });
    if (marker === "-") current.lines.push({ kind: "removed", text: rawLine.slice(1) });
  }

  if (current) hunks.push(current);
  return hunks;
}
