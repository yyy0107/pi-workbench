import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_APPEARANCE_PREFERENCES, type AppearancePreferences } from "../../../appearance";

import {
  APPEARANCE_SETTINGS_PAGES,
  DEFAULT_APPEARANCE_PREFERENCES_BY_PAGE,
  isDefaultAppearanceSettingsPage,
  resolveAppearanceSettingsPage,
} from "./appearance-settings-pages";

test("assigns every appearance preference to exactly one settings page", () => {
  const groupedKeys = APPEARANCE_SETTINGS_PAGES.flatMap((page) =>
    Object.keys(DEFAULT_APPEARANCE_PREFERENCES_BY_PAGE[page]),
  );

  assert.deepEqual([...groupedKeys].sort(), Object.keys(DEFAULT_APPEARANCE_PREFERENCES).sort());
  assert.equal(new Set(groupedKeys).size, groupedKeys.length);
});

test("detects defaults only within the requested settings page", () => {
  const preferences = {
    ...DEFAULT_APPEARANCE_PREFERENCES,
    customBackground: true,
    surfaceOpacity: 50,
    glassBlur: "strong",
    codeTheme: "dracula",
  } satisfies AppearancePreferences;

  assert.equal(isDefaultAppearanceSettingsPage(preferences, "appearance"), false);
  assert.equal(isDefaultAppearanceSettingsPage(preferences, "interface"), true);
  assert.equal(isDefaultAppearanceSettingsPage(preferences, "background"), false);
});

test("page defaults reset one page without changing another", () => {
  const preferences = {
    ...DEFAULT_APPEARANCE_PREFERENCES,
    customBackground: true,
    surfaceColorBlend: 65,
    surfaceOpacity: 50,
    glassBlur: "strong",
    codeTheme: "dracula",
  } satisfies AppearancePreferences;
  const resetTheme = {
    ...preferences,
    ...DEFAULT_APPEARANCE_PREFERENCES_BY_PAGE.appearance,
  } satisfies AppearancePreferences;

  assert.equal(resetTheme.codeTheme, DEFAULT_APPEARANCE_PREFERENCES.codeTheme);
  assert.equal(resetTheme.customBackground, true);
  assert.equal(resetTheme.surfaceColorBlend, 65);
  assert.equal(resetTheme.surfaceOpacity, 50);
  assert.equal(resetTheme.glassBlur, "strong");

  const resetBackground = {
    ...preferences,
    ...DEFAULT_APPEARANCE_PREFERENCES_BY_PAGE.background,
  };
  assert.equal(resetBackground.surfaceColorBlend, DEFAULT_APPEARANCE_PREFERENCES.surfaceColorBlend);
  assert.equal(resetBackground.surfaceOpacity, DEFAULT_APPEARANCE_PREFERENCES.surfaceOpacity);
  assert.equal(resetBackground.glassBlur, DEFAULT_APPEARANCE_PREFERENCES.glassBlur);
  assert.equal(resetBackground.codeTheme, "dracula");
});

test("maps registered section ids to appearance settings pages", () => {
  assert.equal(resolveAppearanceSettingsPage("interface"), "interface");
  assert.equal(resolveAppearanceSettingsPage("background"), "background");
  assert.equal(resolveAppearanceSettingsPage("code"), "appearance");
  assert.equal(resolveAppearanceSettingsPage("appearance"), "appearance");
  assert.equal(resolveAppearanceSettingsPage("unknown"), "appearance");
});

test("theme reset owns all fonts, sizes, weights and code syntax", () => {
  const preferences = {
    ...DEFAULT_APPEARANCE_PREFERENCES,
    uiFont: "local:Ubuntu Sans Mono",
    uiFontWeight: 500,
    uiFontSize: 18,
    contentFont: "local:Georgia",
    contentFontWeight: 300,
    codeFont: "systemMono",
    codeFontWeight: 600,
    codeFontSize: 16,
    codeTheme: "dracula",
  } satisfies AppearancePreferences;
  const reset = { ...preferences, ...DEFAULT_APPEARANCE_PREFERENCES_BY_PAGE.appearance };

  assert.equal(isDefaultAppearanceSettingsPage(preferences, "appearance"), false);
  assert.equal(isDefaultAppearanceSettingsPage(reset, "appearance"), true);
  assert.equal(reset.contentFont, "inherit");
  assert.equal(reset.uiFontSize, DEFAULT_APPEARANCE_PREFERENCES.uiFontSize);
  assert.equal(isDefaultAppearanceSettingsPage(preferences, "interface"), true);
  assert.equal(
    { ...preferences, ...DEFAULT_APPEARANCE_PREFERENCES_BY_PAGE.interface }.uiFontSize,
    18,
  );
  assert.equal(reset.codeFontWeight, 400);
  assert.equal(reset.codeFontSize, DEFAULT_APPEARANCE_PREFERENCES.codeFontSize);
  assert.equal(reset.codeTheme, DEFAULT_APPEARANCE_PREFERENCES.codeTheme);
});
