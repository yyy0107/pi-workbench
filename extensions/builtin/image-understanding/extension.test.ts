import assert from "node:assert/strict";
import test from "node:test";

const { ExtensionManager } = (await import(
  new URL("../../../platform/extensions/extension-manager.ts", import.meta.url).href
)) as typeof import("../../../platform/extensions/extension-manager");
const { imageUnderstandingExtension } = (await import(
  new URL("./extension.ts", import.meta.url).href
)) as typeof import("./extension");
const { IMAGE_RECOGNITION_DATA_PART_NAME } = (await import(
  new URL("./image-recognition-presentation.ts", import.meta.url).href
)) as typeof import("./image-recognition-presentation");

test("registers settings and the exact data renderer for one extension lifecycle", () => {
  const manager = new ExtensionManager();
  const activation = manager.activate(imageUnderstandingExtension);

  assert.equal(manager.isActive("workbench.image-understanding"), true);
  assert.equal(
    manager.settings.getSections().find(({ id }) => id === "image-understanding")?.order,
    45,
  );
  assert.equal(
    manager.settings
      .getItems()
      .some(({ sectionId, id }) => sectionId === "image-understanding" && id === "providers"),
    true,
  );
  assert.equal(manager.renderers.data.get(IMAGE_RECOGNITION_DATA_PART_NAME) !== undefined, true);

  activation.dispose();

  assert.equal(manager.isActive("workbench.image-understanding"), false);
  assert.equal(
    manager.settings.getSections().some(({ id }) => id === "image-understanding"),
    false,
  );
  assert.equal(manager.renderers.data.get(IMAGE_RECOGNITION_DATA_PART_NAME), undefined);
});
