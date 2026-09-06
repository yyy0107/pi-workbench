import assert from "node:assert/strict";
import test from "node:test";

import { createPiI18n } from "../../i18n";
import { BUILTIN_PROMPT_NAMES } from "./builtin-prompt-templates";
import { formatToolboxCount } from "./toolbox-sidebar";

test("sidebar counts include built-in prompts and retain known counts while refreshing", () => {
  const { number } = createPiI18n("en-US");
  const builtins = BUILTIN_PROMPT_NAMES.length;
  assert.equal(formatToolboxCount("idle", builtins, number), "4");
  assert.equal(formatToolboxCount("loading", builtins, number), "4");
  assert.equal(formatToolboxCount("ready", builtins + 2, number), "6");
  assert.equal(formatToolboxCount("loading", builtins + 2, number), "6");
  assert.equal(formatToolboxCount("ready", builtins + 1, number), "5");
  assert.equal(formatToolboxCount("ready", 0, number), "0");
  assert.equal(formatToolboxCount("loading", 0, number), "…");
  assert.equal(formatToolboxCount("failed", 0, number), "—");
  assert.equal(formatToolboxCount("ready", 1234, number), number(1234));
});
