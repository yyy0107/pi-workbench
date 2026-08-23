import assert from "node:assert/strict";
import test from "node:test";

import { WrenchIcon } from "lucide-react";

import type { ToolPresentationDefinition } from "../api/renderer";
import { ExtensionManager } from "../extension-manager";
import { RendererRegistryImpl } from "./renderer-registry";

const presentation = {
  label: "Used",
  activeLabel: "Using",
  icon: WrenchIcon,
  summarize: (part) => part.toolName,
} satisfies ToolPresentationDefinition;

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
