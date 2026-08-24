import assert from "node:assert/strict";
import test from "node:test";

import { WrenchIcon } from "lucide-react";

import type { DataPresentationDefinition, ToolPresentationDefinition } from "../api/renderer";
import { ExtensionManager } from "../extension-manager";
import { RendererRegistryImpl } from "./renderer-registry";

function DisclosureController() {
  return null;
}

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
