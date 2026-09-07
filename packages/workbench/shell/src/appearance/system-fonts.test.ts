import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSystemFontFamilies } from "./system-fonts";
import { parseAppearancePreferences } from "./appearance-preferences";
import { uiFontStack } from "./font-families";

test("system families become persistent, deduplicated CSS-safe font choices", () => {
  const fonts = normalizeSystemFontFamilies([
    " 中文字体 ",
    "中文字体",
    "A, B",
    'A "Quote"',
    "",
    "bad\nname",
  ]);
  assert.deepEqual(fonts, ["local:中文字体", "local:A, B", 'local:A "Quote"']);
  for (const font of fonts) {
    assert.equal(parseAppearancePreferences(JSON.stringify({ uiFont: font })).uiFont, font);
    assert.ok(uiFontStack(font).endsWith(uiFontStack("system")));
  }
  for (const invalid of [null, {}, "Noto Sans", [1], ["Noto Sans", null]]) {
    assert.throws(() => normalizeSystemFontFamilies(invalid), /Invalid/);
  }
});
