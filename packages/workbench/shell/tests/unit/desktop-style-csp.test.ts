import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { numberedHunkLines, type DiffHunk } from "@workbench/code-highlighting";

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
      "../../../client/settings-ui/src/appearance-background.tsx",
      "../../../client/code-highlighting/src/diff/reviewable-diff.tsx",
      "../../../client/code-highlighting/src/workbench-code-editor.tsx",
    ].map((relativePath) =>
      readFile(new URL(relativePath, new URL("../../src/", import.meta.url)), "utf8"),
    ),
  );
  for (const source of sources) {
    assert.doesNotMatch(source, /<style\b|\.style\.cssText\b/u);
  }

  const styles = await readFile(new URL("../../src/styles.css", import.meta.url), "utf8");
  for (const stylesheet of [
    "@workbench/code-highlighting/editor.css",
    "@workbench/code-highlighting/diff.css",
    "@workbench/settings-ui/styles.css",
  ]) {
    assert.equal(styles.includes(`@import "${stylesheet}";`), true, stylesheet);
  }
});
