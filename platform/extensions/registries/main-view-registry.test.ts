import assert from "node:assert/strict";
import test from "node:test";

import { ExtensionManager } from "../extension-manager";
import { MainViewRegistryImpl } from "./main-view-registry";

function ExampleMainView() {
  return null;
}

test("main view definitions are registered as frozen snapshots", () => {
  const registry = new MainViewRegistryImpl();
  const disposable = registry.register({ kind: "example", component: ExampleMainView });

  assert.equal(registry.get("example")?.component, ExampleMainView);
  assert.equal(Object.isFrozen(registry.get("example")), true);
  assert.deepEqual(
    registry.getAll().map(({ kind }) => kind),
    ["example"],
  );

  disposable.dispose();
  assert.equal(registry.get("example"), undefined);
});

test("main view kinds must be unique and non-empty", () => {
  const registry = new MainViewRegistryImpl();
  registry.register({ kind: "example", component: ExampleMainView });

  assert.throws(
    () => registry.register({ kind: "example", component: ExampleMainView }),
    /already registered/,
  );
  assert.throws(
    () => registry.register({ kind: " ", component: ExampleMainView }),
    /Main view kind/,
  );
});

test("extension deactivation removes its main views", () => {
  const manager = new ExtensionManager();
  manager.activate({
    id: "workbench.fixture-main-view",
    name: "Fixture Main View",
    version: "1.0.0",
    setup(context) {
      return context.mainViews.register({ kind: "example", component: ExampleMainView });
    },
  });

  assert.equal(manager.mainViews.getAll().length, 1);
  manager.deactivate("workbench.fixture-main-view");
  assert.equal(manager.mainViews.getAll().length, 0);
});
