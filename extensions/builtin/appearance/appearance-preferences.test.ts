import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_APPEARANCE_PREFERENCES,
  isDefaultAppearancePreferences,
  parseAppearancePreferences,
} from "./appearance-preferences";

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
      lightUiFont: "rounded",
      lightCodeFont: "systemMono",
      lightContrast: 108,
      darkAccentColor: "#ABCDEF",
      darkBackgroundColor: "#111827",
      darkForegroundColor: "#F9FAFB",
      darkUiFont: "serif",
      darkCodeFont: "compactMono",
      darkContrast: 114,
      usePointerCursor: true,
      reduceMotion: true,
      uiFontSize: 18,
      codeFontSize: 15,
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
    lightUiFont: "rounded",
    lightCodeFont: "systemMono",
    lightContrast: 108,
    darkAccentColor: "#abcdef",
    darkBackgroundColor: "#111827",
    darkForegroundColor: "#f9fafb",
    darkUiFont: "serif",
    darkCodeFont: "compactMono",
    darkContrast: 114,
    usePointerCursor: true,
    reduceMotion: true,
    uiFontSize: 18,
    codeFontSize: 15,
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
      lightUiFont: "comicSans",
      lightContrast: 200,
      darkCodeFont: "proportional",
      darkContrast: 20,
      usePointerCursor: "yes",
      reduceMotion: "always",
      uiFontSize: 99,
      codeFontSize: 1,
      showDiffMarkers: "symbols",
    }),
  );

  assert.deepEqual(preferences, DEFAULT_APPEARANCE_PREFERENCES);
  assert.equal(isDefaultAppearancePreferences(preferences), true);
  assert.equal(parseAppearancePreferences("{"), DEFAULT_APPEARANCE_PREFERENCES);
});
