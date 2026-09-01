import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { numberedHunkLines, type DiffHunk } from "./elements/reviewable-diff";

test("keeps generated diff metadata in DOM attributes instead of runtime styles", () => {
  const hunk: DiffHunk = {
    id: "fixture",
    range: "@@ -10,3 +20,4 @@",
    decision: "pending",
    lines: [
      { kind: "context", text: "same" },
      { kind: "removed", text: "before" },
      { kind: "added", text: "after" },
      { kind: "context", text: "same again" },
    ],
  };

  assert.deepEqual(
    numberedHunkLines(hunk).map(({ line, lineNumber }) => [line.kind, lineNumber]),
    [
      ["context", 20],
      ["removed", 11],
      ["added", 21],
      ["context", 22],
    ],
  );
});

test("bundles Shell style rules without runtime style elements or cssText", async () => {
  const sources = await Promise.all(
    [
      "./extensions/builtin/appearance/appearance-background.tsx",
      "./elements/reviewable-diff.tsx",
      "./code-highlighting/workbench-code-editor.tsx",
    ].map((relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8")),
  );
  for (const source of sources) {
    assert.doesNotMatch(source, /<style\b|\.style\.cssText\b/u);
  }

  const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8");
  for (const stylesheet of [
    "./code-highlighting/workbench-code-editor.css",
    "./elements/reviewable-diff.css",
    "./extensions/builtin/appearance/appearance-background.css",
  ]) {
    assert.equal(styles.includes(`@import "${stylesheet}";`), true, stylesheet);
  }
});
