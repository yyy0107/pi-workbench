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
