import assert from "node:assert/strict";
import test from "node:test";

const { ExtensionManager } = (await import(
  new URL("../../../platform/extensions/extension-manager.ts", import.meta.url).href
)) as typeof import("../../../platform/extensions/extension-manager");
const { externalSessionImportExtension } = (await import(
  new URL("./extension.ts", import.meta.url).href
)) as typeof import("./extension");

test("registers external session import only in the Data settings group", () => {
  const manager = new ExtensionManager();
  const activation = manager.activate(externalSessionImportExtension);

  const section = manager.settings.getSections().find(({ id }) => id === "external-session-import");
  assert.equal(section?.group?.id, "data");
  assert.equal(section?.order, 70);
  assert.equal(
    manager.settings
      .getItems()
      .some(({ sectionId, id }) => sectionId === "external-session-import" && id === "sources"),
    true,
  );
  assert.equal(manager.mainViews.get("external-session-import"), undefined);
  assert.equal(manager.slots.get("sidebar.footer").length, 0);
  assert.equal(manager.slots.get("header.right").length, 0);

  activation.dispose();

  assert.equal(
    manager.settings.getSections().some(({ id }) => id === "external-session-import"),
    false,
  );
});
