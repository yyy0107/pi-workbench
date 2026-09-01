import assert from "node:assert/strict";
import test from "node:test";

import {
  APPEARANCE_STORAGE_KEY,
  CODE_THEMES,
  CODE_THEME_PAIRS,
  CORNER_RADIUS_STYLES,
  DEFAULT_APPEARANCE_PREFERENCES,
  isDefaultAppearancePreferences,
  parseAppearancePreferences,
} from "./appearance-preferences";

test("keeps the persisted appearance storage contract stable", () => {
  assert.equal(APPEARANCE_STORAGE_KEY, "workbench.appearance.v1");
});

test("parses persisted appearance preferences", () => {
  const preferences = parseAppearancePreferences(
    JSON.stringify({
      colorMode: "dark",
      customBackground: true,
      backgroundColor: "#AABBCC",
      backgroundBlur: "strong",
      syncSurfaceColors: false,
      surfaceOpacity: 73,
      glassBlur: "medium",
      borderStyle: "dashed",
      customBorderColor: true,
      borderColor: "#112233",
      cornerRadius: "compact",
      lightAccentColor: "#123456",
      lightBackgroundColor: "#FDFDFD",
      lightForegroundColor: "#101010",
      lightContrast: 108,
      darkAccentColor: "#ABCDEF",
      darkBackgroundColor: "#111827",
      darkForegroundColor: "#F9FAFB",
      darkContrast: 114,
      uiFont: "rounded",
      runningIndicatorId: "spinner",
      runningIndicatorStyleId: "weaving",
      runningIndicatorSize: 26,
      codeFont: "jetBrainsMono",
      uiFontSize: 18,
      codeFontSize: 15,
      codeTheme: "dracula",
      showDiffMarkers: false,
    }),
  );

  assert.deepEqual(preferences, {
    colorMode: "dark",
    customBackground: true,
    backgroundColor: "#aabbcc",
    backgroundBlur: "strong",
    syncSurfaceColors: false,
    surfaceOpacity: 73,
    glassBlur: "medium",
    borderStyle: "dashed",
    customBorderColor: true,
    borderColor: "#112233",
    cornerRadius: "compact",
    lightAccentColor: "#123456",
    lightBackgroundColor: "#fdfdfd",
    lightForegroundColor: "#101010",
    lightContrast: 108,
    darkAccentColor: "#abcdef",
    darkBackgroundColor: "#111827",
    darkForegroundColor: "#f9fafb",
    darkContrast: 114,
    uiFont: "rounded",
    runningIndicatorId: "spinner",
    runningIndicatorStyleId: "weaving",
    runningIndicatorSize: 26,
    codeFont: "jetBrainsMono",
    uiFontSize: 18,
    codeFontSize: 15,
    codeTheme: "dracula",
    showDiffMarkers: false,
  });
  assert.equal(isDefaultAppearancePreferences(preferences), false);
});

test("falls back field by field when persisted values are invalid", () => {
  const preferences = parseAppearancePreferences(
    JSON.stringify({
      customBackground: "yes",
      backgroundColor: "red",
      backgroundBlur: "extreme",
      colorMode: "sepia",
      surfaceOpacity: 101,
      glassBlur: "frosted",
      borderStyle: "double",
      cornerRadius: "pill",
      lightAccentColor: "blue",
      lightContrast: 200,
      darkContrast: 20,
      uiFont: "comicSans",
      runningIndicatorId: "sparkles",
      runningIndicatorStyleId: "",
      runningIndicatorSize: 64,
      codeFont: "proportional",
      uiFontSize: 99,
      codeFontSize: 1,
      codeTheme: "rainbow",
      showDiffMarkers: "symbols",
    }),
  );

  assert.deepEqual(preferences, DEFAULT_APPEARANCE_PREFERENCES);
  assert.equal(isDefaultAppearancePreferences(preferences), true);
  assert.equal(parseAppearancePreferences("{"), DEFAULT_APPEARANCE_PREFERENCES);
});

test("ignores retired interaction and control-height preferences", () => {
  const preferences = parseAppearancePreferences(
    JSON.stringify({
      usePointerCursor: true,
      reduceMotion: true,
      controlHeight: 40,
      switchControlHeight: 28,
      buttonControlHeight: 40,
      inputControlHeight: 34,
      dropdownControlHeight: 36,
    }),
  );

  assert.equal("usePointerCursor" in preferences, false);
  assert.equal("reduceMotion" in preferences, false);
  assert.equal("controlHeight" in preferences, false);
  assert.equal("switchControlHeight" in preferences, false);
  assert.equal(isDefaultAppearancePreferences(preferences), true);
});

test("migrates fonts from split light and dark preferences", () => {
  const preferences = parseAppearancePreferences(
    JSON.stringify({
      lightUiFont: "rounded",
      darkUiFont: "serif",
      lightCodeFont: "jetBrainsMono",
      darkCodeFont: "firaCode",
    }),
  );

  assert.equal(preferences.uiFont, "rounded");
  assert.equal(preferences.codeFont, "jetBrainsMono");
  assert.equal("lightUiFont" in preferences, false);
  assert.equal("darkUiFont" in preferences, false);
  assert.equal("lightCodeFont" in preferences, false);
  assert.equal("darkCodeFont" in preferences, false);
});

test("migrates the previous paired code styles to Shiki themes", () => {
  assert.equal(
    parseAppearancePreferences(JSON.stringify({ codeStyle: "github" })).codeTheme,
    "dark-plus",
  );
  assert.equal(
    parseAppearancePreferences(JSON.stringify({ codeStyle: "catppuccin" })).codeTheme,
    "catppuccin-mocha",
  );
});

test("accepts additional bundled Shiki themes", () => {
  for (const codeTheme of [
    "ayu-dark",
    "everforest-light",
    "material-theme-ocean",
    "rose-pine-moon",
    "solarized-light",
  ]) {
    assert.equal(parseAppearancePreferences(JSON.stringify({ codeTheme })).codeTheme, codeTheme);
  }
});

test("accepts package-owned running indicator style ids", () => {
  assert.equal(
    parseAppearancePreferences(JSON.stringify({ runningIndicatorStyleId: "product.wordmark" }))
      .runningIndicatorStyleId,
    "product.wordmark",
  );
});

test("reads legacy activity fields but exposes only generic preference keys", () => {
  const migrated = parseAppearancePreferences(
    JSON.stringify({ piWorkingOrbState: "legacy.product-logo", piWorkingOrbSize: 24 }),
  );

  assert.equal(migrated.runningIndicatorStyleId, "legacy.product-logo");
  assert.equal(migrated.runningIndicatorSize, 24);
  assert.equal("piWorkingOrbState" in migrated, false);
  assert.equal("piWorkingOrbSize" in migrated, false);
});

test("accepts every corner radius step", () => {
  for (const cornerRadius of CORNER_RADIUS_STYLES) {
    assert.equal(
      parseAppearancePreferences(JSON.stringify({ cornerRadius })).cornerRadius,
      cornerRadius,
    );
  }
});

test("pairs every selectable Shiki theme with light and dark appearances", () => {
  assert.deepEqual(CODE_THEME_PAIRS[DEFAULT_APPEARANCE_PREFERENCES.codeTheme], {
    light: "light-plus",
    dark: "dark-plus",
  });

  for (const codeTheme of CODE_THEMES) {
    assert.equal(typeof CODE_THEME_PAIRS[codeTheme].light, "string");
    assert.equal(typeof CODE_THEME_PAIRS[codeTheme].dark, "string");
  }
});
