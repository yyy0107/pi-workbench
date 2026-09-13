import assert from "node:assert/strict";
import test from "node:test";

import { WrenchIcon } from "lucide-react";

import type {
  DataPresentationDefinition,
  MessageBlockRendererContribution,
  ToolPresentationDefinition,
} from "../src/api/renderer";
import { ExtensionManager } from "../src/extension-manager";
import { RendererRegistryImpl } from "../src/registries/renderer-registry";

function DisclosureController() {
  return null;
}

function BlockRenderer() {
  return null;
}

const blockRenderer = {
  id: "workbench.test-block-renderer",
  canRender: (block) => block.kind === "text",
  component: BlockRenderer,
} satisfies MessageBlockRendererContribution;

const presentation = {
  label: "Used",
  activeLabel: "Using",
  icon: WrenchIcon,
  summarize: (block) => block.toolName,
  disclosureController: DisclosureController,
} satisfies ToolPresentationDefinition;

const dataPresentation = {
  display: "timeline",
  isVisible: (block) => block.data !== null,
  isActive: (block) =>
    typeof block.data === "object" &&
    block.data !== null &&
    "status" in block.data &&
    block.data.status === "running",
} satisfies DataPresentationDefinition;

test("tool presentations publish stable frozen snapshots and dispose independently", () => {
  const registry = new RendererRegistryImpl().toolPresentations;
  const emptySnapshot = registry.getPresentationMap();
  let changes = 0;
  const unsubscribe = registry.subscribe(() => {
    changes += 1;
  });

  const disposable = registry.register("custom_tool", presentation);
  const registered = registry.get("custom_tool");
  const populatedSnapshot = registry.getPresentationMap();

  assert.notEqual(registered, presentation);
  assert.equal(registered?.label, "Used");
  assert.equal(registered?.icon, WrenchIcon);
  assert.equal(registered?.disclosureController, DisclosureController);
  assert.equal(Object.isFrozen(registered), true);
  assert.equal(Object.isFrozen(populatedSnapshot), true);
  assert.notEqual(populatedSnapshot, emptySnapshot);
  assert.equal(populatedSnapshot.custom_tool, registered);
  assert.equal(registry.getPresentationMap(), populatedSnapshot);
  assert.equal(changes, 1);

  assert.throws(() => registry.register("custom_tool", presentation), /already registered/);
  assert.throws(() => registry.register("  ", presentation), /non-empty string/);

  disposable.dispose();
  assert.equal(registry.get("custom_tool"), undefined);
  assert.notEqual(registry.getPresentationMap(), populatedSnapshot);
  assert.equal(changes, 2);

  disposable.dispose();
  assert.equal(changes, 2);
  unsubscribe();
});

test("extension lifecycle tracks tool presentation registrations", () => {
  const manager = new ExtensionManager();
  const activation = manager.activate({
    id: "workbench.test-tool-presentation",
    name: "Tool Presentation Test",
    version: "1.0.0",
    setup(context) {
      return context.renderers.toolPresentations.register("custom_tool", presentation);
    },
  });

  assert.equal(manager.renderers.toolPresentations.get("custom_tool")?.label, "Used");

  activation.dispose();
  assert.equal(manager.renderers.toolPresentations.get("custom_tool"), undefined);
});

test("data presentations publish stable frozen snapshots and follow extension lifecycle", () => {
  const manager = new ExtensionManager();
  const emptySnapshot = manager.renderers.dataPresentations.getPresentationMap();
  const activation = manager.activate({
    id: "workbench.test-data-presentation",
    name: "Data Presentation Test",
    version: "1.0.0",
    setup(context) {
      return context.renderers.dataPresentations.register("custom.data", dataPresentation);
    },
  });

  const registered = manager.renderers.dataPresentations.get("custom.data");
  const populatedSnapshot = manager.renderers.dataPresentations.getPresentationMap();
  assert.notEqual(registered, dataPresentation);
  assert.equal(registered?.display, "timeline");
  assert.equal(Object.isFrozen(registered), true);
  assert.equal(Object.isFrozen(populatedSnapshot), true);
  assert.notEqual(populatedSnapshot, emptySnapshot);
  assert.equal(populatedSnapshot["custom.data"], registered);
  assert.equal(
    registered?.isActive?.({
      key: "data-1",
      kind: "data",
      name: "custom.data",
      data: { status: "running" },
    }),
    true,
  );

  activation.dispose();
  assert.equal(manager.renderers.dataPresentations.get("custom.data"), undefined);
});

test("message block renderers publish ordered frozen snapshots and dispose independently", () => {
  const registry = new RendererRegistryImpl().blocks;
  const emptySnapshot = registry.getAll();
  let changes = 0;
  const unsubscribe = registry.subscribe(() => {
    changes += 1;
  });

  const firstDisposable = registry.register(blockRenderer);
  const secondDisposable = registry.register({
    ...blockRenderer,
    id: "workbench.test-block-renderer-second",
  });
  const populatedSnapshot = registry.getAll();

  assert.equal(Object.isFrozen(populatedSnapshot), true);
  assert.equal(Object.isFrozen(populatedSnapshot[0]), true);
  assert.notEqual(populatedSnapshot, emptySnapshot);
  assert.deepEqual(
    populatedSnapshot.map((contribution) => contribution.id),
    ["workbench.test-block-renderer", "workbench.test-block-renderer-second"],
  );
  assert.equal(registry.getAll(), populatedSnapshot);
  assert.equal(changes, 2);
  assert.throws(() => registry.register(blockRenderer), /already registered/);
  assert.throws(() => registry.register({ ...blockRenderer, id: "  " }), /non-empty string/);

  firstDisposable.dispose();
  assert.deepEqual(
    registry.getAll().map((contribution) => contribution.id),
    ["workbench.test-block-renderer-second"],
  );
  secondDisposable.dispose();
  assert.deepEqual(registry.getAll(), []);
  assert.equal(changes, 4);
  unsubscribe();
});

test("extension lifecycle tracks message block renderer registrations", () => {
  const manager = new ExtensionManager();
  const activation = manager.activate({
    id: "workbench.test-block-renderer-extension",
    name: "Message Block Renderer Test",
    version: "1.0.0",
    setup(context) {
      return context.renderers.blocks.register(blockRenderer);
    },
  });

  assert.equal(manager.renderers.blocks.getAll()[0]?.id, blockRenderer.id);

  activation.dispose();
  assert.deepEqual(manager.renderers.blocks.getAll(), []);
});
