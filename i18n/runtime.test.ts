import assert from "node:assert/strict";
import test from "node:test";
import { createI18n } from "./runtime";

test("selects locale-aware plural categories", () => {
  const english = createI18n("en-US");
  const chinese = createI18n("zh-CN");

  assert.equal(english.plural(1), "one");
  assert.equal(english.plural(2), "other");
  assert.equal(english.plural(2, { type: "ordinal" }), "two");
  assert.equal(chinese.plural(1), "other");
  assert.equal(chinese.plural(2), "other");
});
