import assert from "node:assert/strict";
import test from "node:test";

import { SUPPORTED_LOCALES } from "@/contracts/locale";

import { createLocaleDisplayName } from "./locale-display-name";

test("formats every supported locale in every interface language", () => {
  for (const displayLocale of SUPPORTED_LOCALES) {
    const displayName = createLocaleDisplayName(displayLocale);
    for (const locale of SUPPORTED_LOCALES) {
      const label = displayName(locale);
      assert.ok(label.trim());
      assert.notEqual(label, locale);
    }
  }
});
