import assert from "node:assert/strict";
import test from "node:test";

import { sortComposerSuggestions } from "./composer-command-group-order";

test("places Skills second while preserving order within each group", () => {
  const suggestions = [
    { id: "extension-1", group: "extension" as const },
    { id: "builtin-1", group: "builtin" as const },
    { id: "skill-1", group: "skill" as const },
    { id: "extension-2", group: "extension" as const },
    { id: "prompt-1", group: "prompt" as const },
    { id: "workbench-1", group: "workbench" as const },
    { id: "skill-2", group: "skill" as const },
  ];

  assert.deepEqual(
    sortComposerSuggestions(suggestions).map(({ id }) => id),
    ["builtin-1", "skill-1", "skill-2", "extension-1", "extension-2", "prompt-1", "workbench-1"],
  );
});
