import assert from "node:assert/strict";
import test from "node:test";

import { composerCommandArgumentEntries } from "./composer-command-arguments";

test("presents structured command arguments and omits fields already projected as nodes", () => {
  assert.deepEqual(
    composerCommandArgumentEntries(
      {
        customInstructions: "Keep decisions\nand constraints",
        retries: 2,
        options: ["short", true],
      },
      new Set(["retries"]),
    ),
    [
      {
        field: "customInstructions",
        value: "Keep decisions\nand constraints",
      },
      {
        field: "options",
        value: '["short",true]',
      },
    ],
  );
});

test("presents primitive command arguments without inventing a field name", () => {
  assert.deepEqual(composerCommandArgumentEntries("legacy argument"), [
    { value: "legacy argument" },
  ]);
  assert.deepEqual(composerCommandArgumentEntries(""), [{ value: '""' }]);
  assert.deepEqual(composerCommandArgumentEntries(undefined), []);
});
