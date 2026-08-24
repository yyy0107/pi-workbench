import assert from "node:assert/strict";
import test from "node:test";

const { ExtensionManager } = (await import(
  new URL("../../../platform/extensions/extension-manager.ts", import.meta.url).href
)) as typeof import("../../../platform/extensions/extension-manager");
const { imageUnderstandingExtension } = (await import(
  new URL("./extension.ts", import.meta.url).href
)) as typeof import("./extension");
const { IMAGE_RECOGNITION_DATA_PART_NAME, LEGACY_IMAGE_RECOGNITION_DATA_PART_NAME } = (await import(
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
  assert.equal(
    manager.renderers.data.get(LEGACY_IMAGE_RECOGNITION_DATA_PART_NAME) !== undefined,
    true,
  );
  const presentation = manager.renderers.dataPresentations.get(IMAGE_RECOGNITION_DATA_PART_NAME);
  const runningPart = {
    type: "data" as const,
    name: IMAGE_RECOGNITION_DATA_PART_NAME,
    data: {
      version: 1,
      operationId: "recognition-1",
      submissionId: "submission-1",
      revision: 1,
      status: "running",
      stage: "recognizing",
      method: "ocr",
      attachmentCount: 1,
      completedCount: 0,
      progress: 0.5,
    },
  };
  assert.equal(presentation?.display, "timeline");
  assert.equal(presentation?.isVisible?.(runningPart), true);
  assert.equal(presentation?.isActive?.(runningPart), true);
  assert.equal(
    presentation?.isVisible?.({
      ...runningPart,
      data: {
        ...runningPart.data,
        revision: 2,
        status: "skipped",
        stage: undefined,
        method: "native",
        progress: 0,
      },
    }),
    false,
  );

  activation.dispose();

  assert.equal(manager.isActive("workbench.image-understanding"), false);
  assert.equal(
    manager.settings.getSections().some(({ id }) => id === "image-understanding"),
    false,
  );
  assert.equal(manager.renderers.data.get(IMAGE_RECOGNITION_DATA_PART_NAME), undefined);
  assert.equal(manager.renderers.data.get(LEGACY_IMAGE_RECOGNITION_DATA_PART_NAME), undefined);
  assert.equal(
    manager.renderers.dataPresentations.get(IMAGE_RECOGNITION_DATA_PART_NAME),
    undefined,
  );
});
