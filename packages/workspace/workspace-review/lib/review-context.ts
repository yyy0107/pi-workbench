import { diffContextRanges, type DiffLine } from "@workbench/code-highlighting";

export interface ReviewContextSection {
  start: number;
  end: number;
  collapsed: boolean;
}

/** Partition loaded lines without dropping or duplicating context between change blocks. */
export function reviewContextSections(lines: readonly DiffLine[]): ReviewContextSection[] {
  const sections: ReviewContextSection[] = [];
  let offset = 0;
  for (const range of diffContextRanges(lines)) {
    if (range.start > offset) {
      sections.push({ start: offset, end: range.start, collapsed: true });
    }
    sections.push({ start: range.start, end: range.end, collapsed: false });
    offset = range.end;
  }
  if (offset < lines.length) {
    sections.push({ start: offset, end: lines.length, collapsed: true });
  }
  return sections;
}
