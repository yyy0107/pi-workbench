import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_LOCALE, SUPPORTED_LOCALES, matchLocale } from "./config";
import { messages } from "./messages";

test("registers one complete message catalog for every supported locale", () => {
  assert.deepEqual(Object.keys(messages), [...SUPPORTED_LOCALES]);
  assert.ok(messages[DEFAULT_LOCALE]);
});

test("matches exact and language-compatible locale preferences", () => {
  assert.equal(matchLocale("en-US"), "en-US");
  assert.equal(matchLocale("en-GB"), "en-US");
  assert.equal(matchLocale("zh-Hans-CN"), "zh-CN");
  assert.equal(matchLocale("ZH-cn"), "zh-CN");
  assert.equal(matchLocale("fr-FR"), undefined);
  assert.equal(matchLocale(null), undefined);
});
