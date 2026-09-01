import assert from "node:assert/strict";
import test from "node:test";

import { WrenchIcon } from "lucide-react";

import type {
  DataPresentationDefinition,
  MessagePartRendererContribution,
  ToolPresentationDefinition,
} from "../src/api/renderer";
import { ExtensionManager } from "../src/extension-manager";
import { RendererRegistryImpl } from "../src/registries/renderer-registry";

function DisclosureController() {
  return null;
}

function PartRenderer() {
  return null;
}

const partRenderer = {
  id: "workbench.test-part-renderer",
  canRender: (part) => part.type === "text",
  component: PartRenderer,
} satisfies MessagePartRendererContribution;

const presentation = {
  label: "Used",
  activeLabel: "Using",
  icon: WrenchIcon,
  summarize: (part) => part.toolName,
  disclosureController: DisclosureController,
} satisfies ToolPresentationDefinition;

const dataPresentation = {
  display: "timeline",
  isVisible: (part) => part.data !== null,
  isActive: (part) =>
    typeof part.data === "object" &&
    part.data !== null &&
    "status" in part.data &&
    part.data.status === "running",
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
    registered?.isActive?.({ type: "data", name: "custom.data", data: { status: "running" } }),
    true,
  );

  activation.dispose();
  assert.equal(manager.renderers.dataPresentations.get("custom.data"), undefined);
});

test("message part renderers publish ordered frozen snapshots and dispose independently", () => {
  const registry = new RendererRegistryImpl().parts;
  const emptySnapshot = registry.getAll();
  let changes = 0;
  const unsubscribe = registry.subscribe(() => {
    changes += 1;
  });

  const firstDisposable = registry.register(partRenderer);
  const secondDisposable = registry.register({
    ...partRenderer,
    id: "workbench.test-part-renderer-second",
  });
  const populatedSnapshot = registry.getAll();

  assert.equal(Object.isFrozen(populatedSnapshot), true);
  assert.equal(Object.isFrozen(populatedSnapshot[0]), true);
  assert.notEqual(populatedSnapshot, emptySnapshot);
  assert.deepEqual(
    populatedSnapshot.map((contribution) => contribution.id),
    ["workbench.test-part-renderer", "workbench.test-part-renderer-second"],
  );
  assert.equal(registry.getAll(), populatedSnapshot);
  assert.equal(changes, 2);
  assert.throws(() => registry.register(partRenderer), /already registered/);
  assert.throws(() => registry.register({ ...partRenderer, id: "  " }), /non-empty string/);

  firstDisposable.dispose();
  assert.deepEqual(
    registry.getAll().map((contribution) => contribution.id),
    ["workbench.test-part-renderer-second"],
  );
  secondDisposable.dispose();
  assert.deepEqual(registry.getAll(), []);
  assert.equal(changes, 4);
  unsubscribe();
});

test("extension lifecycle tracks message part renderer registrations", () => {
  const manager = new ExtensionManager();
  const activation = manager.activate({
    id: "workbench.test-part-renderer-extension",
    name: "Message Part Renderer Test",
    version: "1.0.0",
    setup(context) {
      return context.renderers.parts.register(partRenderer);
    },
  });

  assert.equal(manager.renderers.parts.getAll()[0]?.id, partRenderer.id);

  activation.dispose();
  assert.deepEqual(manager.renderers.parts.getAll(), []);
});
