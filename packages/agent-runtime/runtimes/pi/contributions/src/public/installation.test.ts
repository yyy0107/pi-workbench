import assert from "node:assert/strict";
import test from "node:test";
import { ExtensionManager } from "@workbench/extension-sdk/internal";

import { createPiI18n } from "../i18n";

import { piAgentRuntimeExtensionGroups, piAgentRuntimeExtensions } from "./installation";

const groupIds = (group: readonly { id: string }[]) => group.map(({ id }) => id);

test("keeps Pi extension groups deeply frozen with their app-composition ordering", () => {
  assert.equal(Object.isFrozen(piAgentRuntimeExtensionGroups), true);
  for (const group of Object.values(piAgentRuntimeExtensionGroups)) {
    assert.equal(Object.isFrozen(group), true);
  }
  assert.equal(Object.isFrozen(piAgentRuntimeExtensions), true);

  assert.deepEqual(groupIds(piAgentRuntimeExtensions), [
    "workbench.agent-configuration",
    "workbench.setting-model-config",
    "workbench.pi.settings-action",
    "workbench.usage-statistics",
    "workbench.toolbox",
    "workbench.connection-status",
    "workbench.context-trace",
    "workbench.about",
  ]);
  assert.deepEqual(groupIds(piAgentRuntimeExtensions), [
    ...Object.values(piAgentRuntimeExtensionGroups).flatMap(groupIds),
  ]);
  assert.throws(() => {
    (
      piAgentRuntimeExtensionGroups.configuration as unknown as { push(extension: unknown): void }
    ).push({});
  }, /not extensible/);
});

test("installs the localized About settings page with the import entry removed", () => {
  const manager = new ExtensionManager();
  const about = piAgentRuntimeExtensions.find(({ id }) => id === "workbench.about");
  assert.ok(about);
  const activation = manager.activate(about);
  const section = manager.settings.getSections().find(({ id }) => id === "about");
  assert.ok(section);
  assert.equal(section.order, 100);
  assert.equal(createPiI18n("en-US").text(section.title), "About");
  assert.equal(createPiI18n("zh-CN").text(section.title), "关于");
  assert.ok(
    manager.settings
      .getItems()
      .some(({ sectionId, id }) => sectionId === "about" && id === "application"),
  );
  assert.equal(
    piAgentRuntimeExtensions.some(({ id }) => id === "workbench.external-session-import"),
    false,
  );

  activation.dispose();
  assert.equal(manager.settings.getSections().length, 0);
  assert.equal(manager.settings.getItems().length, 0);
});

test("registers usage statistics in the Data settings group in both base languages", () => {
  const manager = new ExtensionManager();
  const extension = piAgentRuntimeExtensions.find(({ id }) => id === "workbench.usage-statistics");
  assert.ok(extension);
  const activation = manager.activate(extension);
  const section = manager.settings.getSections().find(({ id }) => id === "usage-statistics");
  assert.ok(section);
  assert.equal(section.group?.id, "data");
  assert.equal(createPiI18n("en-US").text(section.title), "Usage statistics");
  assert.equal(createPiI18n("zh-CN").text(section.title), "使用统计");
  assert.ok(manager.settings.getItems().some(({ sectionId }) => sectionId === section.id));
  activation.dispose();
  assert.equal(manager.settings.getSections().length, 0);
});
