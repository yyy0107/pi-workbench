import assert from "node:assert/strict";
import test from "node:test";
import type { DiffLine } from "@workbench/code-highlighting";
import { reviewContextSections } from "../lib/review-context";

const context = (count: number): DiffLine[] =>
  Array.from({ length: count }, (_, index) => ({ kind: "context", text: `line ${index}` }));

test("context sections preserve every loaded line around separated edits", () => {
  const lines: DiffLine[] = [
    ...context(5),
    { kind: "removed", text: "old" },
    { kind: "added", text: "new" },
    ...context(8),
    { kind: "added", text: "another" },
    ...context(5),
  ];
  const sections = reviewContextSections(lines);
  assert.deepEqual(sections, [
    { start: 0, end: 4, collapsed: true },
    { start: 4, end: 8, collapsed: false },
    { start: 8, end: 14, collapsed: true },
    { start: 14, end: 17, collapsed: false },
    { start: 17, end: 21, collapsed: true },
  ]);
  assert.deepEqual(
    sections.flatMap(({ start, end }) => lines.slice(start, end)),
    lines,
  );
  for (const section of sections.filter((section) => section.collapsed)) {
    assert.ok(lines.slice(section.start, section.end).every((line) => line.kind === "context"));
  }
});

test("nearby edits do not duplicate context and additions and deletions stay visible", () => {
  for (const gap of [0, 1, 2, 3]) {
    const lines: DiffLine[] = [
      { kind: "removed", text: "旧" },
      ...context(gap),
      { kind: "added", text: "新" },
    ];
    const sections = reviewContextSections(lines);
    assert.deepEqual(
      sections.flatMap(({ start, end }) => lines.slice(start, end)),
      lines,
    );
    assert.ok(
      sections
        .filter((section) => section.collapsed)
        .every(({ start, end }) =>
          lines.slice(start, end).every((line) => line.kind === "context"),
        ),
    );
  }
});

test("empty and unchanged hunks have no invented change rows", () => {
  assert.deepEqual(reviewContextSections([]), []);
  assert.deepEqual(reviewContextSections(context(4)), [{ start: 0, end: 4, collapsed: true }]);
});
