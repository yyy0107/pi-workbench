import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { WorkbenchAgentRuntimeEnvironmentProvider } from "@workbench/agent-runtime-client/context";
import type { WorkbenchAgentRuntimeCapabilities } from "@workbench/agent-runtime-client/capabilities";
import { installMinimalReactDomEnvironment } from "../../../../test/react-dom-environment";
import assert from "node:assert/strict";
import test from "node:test";

const { ExtensionManager } =
  (await import("@workbench/extension-sdk/internal")) as typeof import("@workbench/extension-sdk/internal");
const { attachmentUnderstandingExtension } = (await import(
  new URL("./extension.ts", import.meta.url).href
)) as typeof import("./extension");
const { ATTACHMENT_RECOGNITION_DATA_PART_NAME, LEGACY_IMAGE_RECOGNITION_DATA_PART_NAME } =
  (await import(
    new URL("./image-recognition-presentation.ts", import.meta.url).href
  )) as typeof import("./image-recognition-presentation");

test("registers settings and the exact data renderer for one extension lifecycle", async () => {
  const manager = new ExtensionManager();
  const activation = manager.activate(attachmentUnderstandingExtension);
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  const Entries = manager.slots.get("shell.overlay")[0]!.component;
  try {
    assert.equal(manager.settings.getSections().length, 0);
    await act(async () =>
      root.render(
        createElement(WorkbenchAgentRuntimeEnvironmentProvider, {
          id: "fixture",
          commands: [],
          capabilities: {
            attachmentUnderstanding: {},
            models: {},
          } as WorkbenchAgentRuntimeCapabilities,
          children: createElement(Entries),
        }),
      ),
    );

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
    assert.equal(
      manager.renderers.data.get(ATTACHMENT_RECOGNITION_DATA_PART_NAME) !== undefined,
      true,
    );
    assert.equal(
      manager.renderers.data.get(LEGACY_IMAGE_RECOGNITION_DATA_PART_NAME) !== undefined,
      true,
    );
    const presentation = manager.renderers.dataPresentations.get(
      ATTACHMENT_RECOGNITION_DATA_PART_NAME,
    );
    const runningBlock = {
      key: "data:recognition-1",
      kind: "data" as const,
      name: ATTACHMENT_RECOGNITION_DATA_PART_NAME,
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
    assert.equal(presentation?.isVisible?.(runningBlock), true);
    assert.equal(presentation?.isActive?.(runningBlock), true);
    assert.equal(
      presentation?.isVisible?.({
        ...runningBlock,
        data: {
          ...runningBlock.data,
          revision: 2,
          status: "skipped",
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
    assert.equal(manager.renderers.data.get(ATTACHMENT_RECOGNITION_DATA_PART_NAME), undefined);
    assert.equal(manager.renderers.data.get(LEGACY_IMAGE_RECOGNITION_DATA_PART_NAME), undefined);
    assert.equal(
      manager.renderers.dataPresentations.get(ATTACHMENT_RECOGNITION_DATA_PART_NAME),
      undefined,
    );
  } finally {
    activation.dispose();
    await act(async () => root.unmount());
    dom.restore();
  }
});
