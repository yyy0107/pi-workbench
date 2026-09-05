import assert from "node:assert/strict";
import test from "node:test";

import {
  expandPromptTemplateContent,
  parsePromptTemplateArguments,
} from "../../src/commands/prompt-template-expander";

test("parses quoted prompt-template arguments", () => {
  assert.deepEqual(parsePromptTemplateArguments(`one "two words" 'three words'`), [
    "one",
    "two words",
    "three words",
  ]);
});

test("expands positional, aggregate, default, and slice placeholders", () => {
  assert.equal(
    expandPromptTemplateContent(
      "$1|$2|$ARGUMENTS|${3:-fallback}|${@:2}|${@:2:1}",
      `one "two words"`,
    ),
    "one|two words|one two words|fallback|two words|two words",
  );
});

test("bounds expansion before repeated arguments can allocate an oversized result", () => {
  assert.equal(expandPromptTemplateContent("$1 $1", "abc", 7), "abc abc");
  assert.throws(() => expandPromptTemplateContent("$1 $1", "abc", 6), RangeError);
});
