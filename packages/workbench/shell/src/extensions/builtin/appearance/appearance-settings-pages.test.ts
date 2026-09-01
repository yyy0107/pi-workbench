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
    codeTheme: "dracula",
  } satisfies AppearancePreferences;

  assert.equal(isDefaultAppearanceSettingsPage(preferences, "appearance"), true);
  assert.equal(isDefaultAppearanceSettingsPage(preferences, "interface"), true);
  assert.equal(isDefaultAppearanceSettingsPage(preferences, "background"), false);
  assert.equal(isDefaultAppearanceSettingsPage(preferences, "code"), false);
});

test("page defaults reset one page without changing another", () => {
  const preferences = {
    ...DEFAULT_APPEARANCE_PREFERENCES,
    customBackground: true,
    codeTheme: "dracula",
  } satisfies AppearancePreferences;
  const resetCode = {
    ...preferences,
    ...DEFAULT_APPEARANCE_PREFERENCES_BY_PAGE.code,
  } satisfies AppearancePreferences;

  assert.equal(resetCode.codeTheme, DEFAULT_APPEARANCE_PREFERENCES.codeTheme);
  assert.equal(resetCode.customBackground, true);
});

test("maps registered section ids to appearance settings pages", () => {
  assert.equal(resolveAppearanceSettingsPage("interface"), "interface");
  assert.equal(resolveAppearanceSettingsPage("background"), "background");
  assert.equal(resolveAppearanceSettingsPage("code"), "code");
  assert.equal(resolveAppearanceSettingsPage("appearance"), "appearance");
  assert.equal(resolveAppearanceSettingsPage("unknown"), "appearance");
});
