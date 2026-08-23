import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_HIGHLIGHTED_CODE_CHARACTERS,
  MAX_HIGHLIGHTED_CODE_LINES,
  shouldHighlightWorkbenchCode,
} from "./code-highlight-policy";

test("allows code at the highlighting character and line budgets", () => {
  assert.equal(shouldHighlightWorkbenchCode("x".repeat(MAX_HIGHLIGHTED_CODE_CHARACTERS)), true);
  assert.equal(shouldHighlightWorkbenchCode("\n".repeat(MAX_HIGHLIGHTED_CODE_LINES - 1)), true);
});

test("skips highlighting when either budget is exceeded", () => {
  assert.equal(
    shouldHighlightWorkbenchCode("x".repeat(MAX_HIGHLIGHTED_CODE_CHARACTERS + 1)),
    false,
  );
  assert.equal(shouldHighlightWorkbenchCode("\n".repeat(MAX_HIGHLIGHTED_CODE_LINES)), false);
});
