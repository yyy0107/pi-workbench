import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_APPEARANCE_PREFERENCES,
  parseAppearancePreferences,
} from "./appearance-preferences";
import { codeFontStack, uiFontStack } from "./font-families";

test("old bundled presets migrate to installed font selections", () => {
  const restored = parseAppearancePreferences(
    JSON.stringify({
      uiFont: "notoSansSc",
      contentFont: "notoSerifSc",
      codeFont: "jetBrainsMono",
    }),
  );
  assert.equal(restored.uiFont, "local:Noto Sans SC");
  assert.equal(restored.contentFont, "local:Noto Serif SC");
  assert.equal(restored.codeFont, "local:JetBrains Mono");
});

test("local font choices survive persistence without requiring a font inventory", () => {
  const choices = {
    uiFont: "local:中文字体",
    contentFont: "local:Content Font",
    codeFont: "local:Code Font",
    uiFontWeight: 500,
  };
  const restored = parseAppearancePreferences(JSON.stringify(choices));
  for (const [key, value] of Object.entries(choices))
    assert.equal(restored[key as keyof typeof choices], value);
  assert.equal(
    parseAppearancePreferences(JSON.stringify({ contentFont: "inherit" })).contentFont,
    "inherit",
  );
  for (const font of [
    "local:",
    "local:  ",
    "local:bad\nfont",
    `local:${"a".repeat(251)}`,
    "random-font",
  ]) {
    const invalid = parseAppearancePreferences(
      JSON.stringify({ uiFont: font, contentFont: font, codeFont: font }),
    );
    assert.equal(invalid.uiFont, DEFAULT_APPEARANCE_PREFERENCES.uiFont);
    assert.equal(invalid.contentFont, DEFAULT_APPEARANCE_PREFERENCES.contentFont);
    assert.equal(invalid.codeFont, DEFAULT_APPEARANCE_PREFERENCES.codeFont);
  }
  assert.equal(DEFAULT_APPEARANCE_PREFERENCES.uiFont, "system");
  assert.equal(DEFAULT_APPEARANCE_PREFERENCES.codeFont, "systemMono");
});

test("local CSS families are quoted as one name and retain system fallback", () => {
  assert.equal(uiFontStack('local:A, "B"\\C'), '"A, \\"B\\"\\\\C", ' + uiFontStack("system"));
  assert.equal(codeFontStack("local:Code Font"), '"Code Font", ' + codeFontStack("systemMono"));
});
