import assert from "node:assert/strict";
import test from "node:test";

import { SUPPORTED_LOCALES } from "@workbench/contracts/locale";

import { createLocaleDisplayName } from "./locale-display-name";

test("formats every supported locale as a language without its region", () => {
  for (const displayLocale of SUPPORTED_LOCALES) {
    const displayName = createLocaleDisplayName(displayLocale);
    const expectedNames = new Intl.DisplayNames(displayLocale, { type: "language" });
    for (const locale of SUPPORTED_LOCALES) {
      const label = displayName(locale);
      const language = new Intl.Locale(locale).language;
      assert.ok(label.trim());
      assert.notEqual(label, locale);
      assert.equal(label, expectedNames.of(language));
    }
  }
});
