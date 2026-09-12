import type { DiffLine } from "./code-diff";

export interface ParsedPatchHunk {
  oldStart: number;
  newStart: number;
  lines: readonly DiffLine[];
}

export interface DiffContextRange {
  start: number;
  end: number;
  hiddenBefore: number;
  hiddenAfter: number;
}

export interface VisiblePatchHunk extends ParsedPatchHunk {
  sourceHunkIndex: number;
  sourceBlockIndex: number;
  hiddenContextBefore: number;
  hiddenContextAfter: number;
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

/** Keep one unchanged line around each change and expose the rest as a countable collapsed block. */
export function diffContextRanges(lines: readonly DiffLine[]): readonly DiffContextRange[] {
  const ranges: Array<{ start: number; end: number }> = [];
  let changeStart: number | undefined;

  const appendRange = (changeEnd: number) => {
    if (changeStart === undefined) return;

    const next = {
      start: Math.max(0, changeStart - 1),
      end: Math.min(lines.length, changeEnd + 1),
    };
    const previous = ranges.at(-1);
    if (previous && next.start < previous.end) {
      previous.end = Math.max(previous.end, next.end);
    } else {
      ranges.push(next);
    }
    changeStart = undefined;
  };

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.kind !== "context") changeStart ??= index;
    else appendRange(index);
  }
  appendRange(lines.length);

  return ranges.map((range, index) => ({
    ...range,
    hiddenBefore: range.start - (index === 0 ? 0 : (ranges[index - 1]?.end ?? 0)),
    hiddenAfter: index === ranges.length - 1 ? lines.length - range.end : 0,
  }));
}

/** Convert parsed hunks into visible change blocks while preserving omitted context counts. */
export function visiblePatchHunks(hunks: readonly ParsedPatchHunk[]): readonly VisiblePatchHunk[] {
  const visible: VisiblePatchHunk[] = [];
  let previous: { oldEnd: number; hiddenAfter: number } | undefined;

  hunks.forEach((hunk, sourceHunkIndex) => {
    const ranges = diffContextRanges(hunk.lines);
    const oldPositions = Array.from({ length: hunk.lines.length }, () => 0);
    const newPositions = Array.from({ length: hunk.lines.length }, () => 0);
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;

    hunk.lines.forEach((line, index) => {
      oldPositions[index] = oldLine;
      newPositions[index] = newLine;
      if (line.kind !== "added") oldLine += 1;
      if (line.kind !== "removed") newLine += 1;
    });

    const oldCount = hunk.lines.filter((line) => line.kind !== "added").length;
    const previousHunk = previous;
    ranges.forEach((range, sourceBlockIndex) => {
      const hiddenContextBefore =
        range.hiddenBefore +
        (sourceBlockIndex === 0 && previousHunk
          ? previousHunk.hiddenAfter + Math.max(0, hunk.oldStart - previousHunk.oldEnd)
          : 0);
      const hiddenContextAfter =
        sourceHunkIndex === hunks.length - 1 && sourceBlockIndex === ranges.length - 1
          ? range.hiddenAfter
          : 0;

      visible.push({
        oldStart: oldPositions[range.start] ?? hunk.oldStart,
        newStart: newPositions[range.start] ?? hunk.newStart,
        lines: hunk.lines.slice(range.start, range.end),
        sourceHunkIndex,
        sourceBlockIndex,
        hiddenContextBefore,
        hiddenContextAfter,
      });
    });

    previous = {
      oldEnd: hunk.oldStart + oldCount,
      hiddenAfter: ranges.at(-1)?.hiddenAfter ?? 0,
    };
  });

  return visible;
}
