import assert from "node:assert/strict";
import test from "node:test";

import { parseAskUserEnabled } from "./ask-user-preferences";

test("parses the persisted Ask User capability preference defensively", () => {
  assert.equal(parseAskUserEnabled(null), true);
  assert.equal(parseAskUserEnabled('{"enabled":true}'), true);
  assert.equal(parseAskUserEnabled('{"enabled":false}'), false);
  assert.equal(parseAskUserEnabled('{"enabled":"false"}'), true);
  assert.equal(parseAskUserEnabled("not-json"), true);
});
