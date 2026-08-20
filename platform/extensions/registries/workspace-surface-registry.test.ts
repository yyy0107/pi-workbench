import assert from "node:assert/strict";
import test from "node:test";

import { PanelsTopLeftIcon } from "lucide-react";

import { ExtensionManager } from "../extension-manager";
import { WorkspaceSurfaceRegistryImpl } from "./workspace-surface-registry";

const definition = {
  kind: "fixture",
  icon: PanelsTopLeftIcon,
  cachePolicy: "keep-alive" as const,
  getResourceKey: () => "fixture:one",
  render: () => null,
};

test("workspace surface definitions are unique and disposable", () => {
  const registry = new WorkspaceSurfaceRegistryImpl();
  const disposable = registry.register(definition);

  assert.equal(registry.get("fixture")?.kind, "fixture");
  assert.equal(Object.isFrozen(registry.get("fixture")), true);
  assert.throws(() => registry.register(definition), /already registered/);

  disposable.dispose();
  assert.equal(registry.get("fixture"), undefined);
});

test("extension deactivation removes its workspace capabilities", () => {
  const manager = new ExtensionManager();
  manager.activate({
    id: "workbench.fixture-workspace",
    name: "Fixture Workspace",
    version: "1.0.0",
    setup(context) {
      return context.workspace.register(definition);
    },
  });

  assert.equal(manager.workspace.getAll().length, 1);
  manager.deactivate("workbench.fixture-workspace");
  assert.equal(manager.workspace.getAll().length, 0);
});

test("failed extension setup rolls back workspace capabilities", () => {
  const manager = new ExtensionManager();

  assert.throws(
    () =>
      manager.activate({
        id: "workbench.broken-workspace",
        name: "Broken Workspace",
        version: "1.0.0",
        setup(context) {
          context.workspace.register(definition);
          throw new Error("setup failed");
        },
      }),
    /setup failed/,
  );

  assert.equal(manager.workspace.getAll().length, 0);
});
