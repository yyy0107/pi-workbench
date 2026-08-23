import assert from "node:assert/strict";
import test from "node:test";

import { hasRenderableMarkdown } from "./composer-markdown-detection";

test("detects Markdown that should be converted into Composer formatting", () => {
  assert.equal(hasRenderableMarkdown("ordinary message"), false);
  assert.equal(hasRenderableMarkdown("src/components/user_profile.ts"), false);
  assert.equal(hasRenderableMarkdown("# Heading"), true);
  assert.equal(hasRenderableMarkdown("- first\n- second"), true);
  assert.equal(hasRenderableMarkdown("**bold** and `code`"), true);
  assert.equal(hasRenderableMarkdown("[Workbench](https://example.com)"), true);
  assert.equal(hasRenderableMarkdown("| A | B |\n| --- | --- |"), true);
});
