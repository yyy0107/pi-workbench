import assert from "node:assert/strict";
import test from "node:test";

import { SettingsRegistryImpl } from "./settings-registry";

function AppearanceHeaderAction() {
  return null;
}

function LanguageSettingsItem() {
  return null;
}

test("settings sections preserve navigation groups and global order", () => {
  const registry = new SettingsRegistryImpl();
  registry.registerSection({
    id: "model",
    title: "Model",
    group: { id: "intelligence", title: "AI" },
    order: 40,
  });
  registry.registerSection({
    id: "appearance",
    title: "Appearance",
    headerAction: AppearanceHeaderAction,
    group: { id: "basics", title: "Basics" },
    order: 10,
  });

  assert.deepEqual(
    registry.getSections().map(({ id, group }) => [id, group?.id]),
    [
      ["appearance", "basics"],
      ["model", "intelligence"],
    ],
  );
  assert.equal(Object.isFrozen(registry.getSections()[0]?.group), true);
  assert.equal(registry.getSections()[0]?.headerAction, AppearanceHeaderAction);
});

test("settings section groups require stable ids and titles", () => {
  const registry = new SettingsRegistryImpl();

  assert.throws(
    () =>
      registry.registerSection({
        id: "appearance",
        title: "Appearance",
        group: { id: " ", title: "Basics" },
      }),
    /group id/,
  );
  assert.throws(
    () =>
      registry.registerSection({
        id: "appearance",
        title: "Appearance",
        group: { id: "basics", title: " " },
      }),
    /empty title/,
  );
});

test("settings items preserve frozen searchable metadata", () => {
  const registry = new SettingsRegistryImpl();
  registry.registerItem({
    sectionId: "general",
    id: "language",
    title: "Language",
    description: "Choose the interface language.",
    keywords: ["Locale", "Translation"],
    component: LanguageSettingsItem,
  });

  const item = registry.getItems()[0];
  assert.equal(item?.title, "Language");
  assert.equal(item?.description, "Choose the interface language.");
  assert.deepEqual(item?.keywords, ["Locale", "Translation"]);
  assert.equal(Object.isFrozen(item?.keywords), true);
  assert.equal(Object.isFrozen(item), true);
});

test("settings items require non-empty searchable metadata", () => {
  const registry = new SettingsRegistryImpl();

  assert.throws(
    () =>
      registry.registerItem({
        sectionId: "general",
        id: "language",
        title: " ",
        component: LanguageSettingsItem,
      }),
    /empty title/,
  );
  assert.throws(
    () =>
      registry.registerItem({
        sectionId: "general",
        id: "language",
        title: "Language",
        keywords: [""],
        component: LanguageSettingsItem,
      }),
    /empty keyword/,
  );
});
