import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_LOCALE, SUPPORTED_LOCALES, isLocale } from "./locale";

test("defines unique canonical BCP 47 locale identifiers", () => {
  assert.ok(SUPPORTED_LOCALES.length > 0);
  assert.equal(new Set(SUPPORTED_LOCALES).size, SUPPORTED_LOCALES.length);
  assert.ok(SUPPORTED_LOCALES.includes(DEFAULT_LOCALE));

  for (const locale of SUPPORTED_LOCALES) {
    assert.equal(new Intl.Locale(locale).toString(), locale);
  }
});

test("recognizes only locales from the shared contract", () => {
  for (const locale of SUPPORTED_LOCALES) assert.equal(isLocale(locale), true);
  for (const value of [undefined, null, "", "en", "zh", "fr-FR", 1, {}]) {
    assert.equal(isLocale(value), false);
  }
});
