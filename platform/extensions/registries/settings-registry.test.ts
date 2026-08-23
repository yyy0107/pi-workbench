import assert from "node:assert/strict";
import test from "node:test";

import { SettingsRegistryImpl } from "./settings-registry";

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
