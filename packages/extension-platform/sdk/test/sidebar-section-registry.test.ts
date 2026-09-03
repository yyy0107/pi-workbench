import assert from "node:assert/strict";
import test from "node:test";

import { HouseIcon, ToolboxIcon } from "lucide-react";

import { ExtensionManager } from "../src/extension-manager";
import { SidebarSectionRegistryImpl } from "../src/registries/sidebar-section-registry";

function WorkspaceSection() {
  return null;
}

function ToolboxSection() {
  return null;
}

test("sidebar sections preserve order and frozen navigation metadata", () => {
  const registry = new SidebarSectionRegistryImpl();
  registry.register({
    id: "toolbox",
    title: "Toolbox",
    icon: ToolboxIcon,
    component: ToolboxSection,
    order: 20,
    mainViewKinds: ["toolbox", "package-details"],
    search: { label: "Search Toolbox", placeholder: "Search capabilities" },
  });
  registry.register({
    id: "workspace",
    title: "Workspace",
    icon: HouseIcon,
    component: WorkspaceSection,
    order: 0,
  });

  assert.deepEqual(
    registry.getAll().map(({ id }) => id),
    ["workspace", "toolbox"],
  );
  const toolbox = registry.get("toolbox");
  assert.equal(Object.isFrozen(toolbox), true);
  assert.equal(Object.isFrozen(toolbox?.mainViewKinds), true);
  assert.equal(Object.isFrozen(toolbox?.search), true);
});

test("sidebar sections validate ids, labels and Main View kinds", () => {
  const registry = new SidebarSectionRegistryImpl();

  assert.throws(
    () =>
      registry.register({
        id: " ",
        title: "Workspace",
        icon: HouseIcon,
        component: WorkspaceSection,
      }),
    /section id/,
  );
  assert.throws(
    () =>
      registry.register({
        id: "workspace",
        title: " ",
        icon: HouseIcon,
        component: WorkspaceSection,
      }),
    /title/,
  );
  assert.throws(
    () =>
      registry.register({
        id: "toolbox",
        title: "Toolbox",
        icon: ToolboxIcon,
        component: ToolboxSection,
        mainViewKinds: ["toolbox", "toolbox"],
      }),
    /duplicate Main View kinds/,
  );
});

test("disposing a sidebar section restores a stable empty snapshot", () => {
  const registry = new SidebarSectionRegistryImpl();
  const initial = registry.getAll();
  const registration = registry.register({
    id: "workspace",
    title: "Workspace",
    icon: HouseIcon,
    component: WorkspaceSection,
  });

  registration.dispose();

  assert.deepEqual(registry.getAll(), []);
  assert.equal(registry.getAll(), initial);
});

test("extension deactivation unregisters its sidebar section", () => {
  const manager = new ExtensionManager();
  manager.activate({
    id: "workbench.fixture-sidebar",
    name: "Fixture Sidebar",
    version: "1.0.0",
    setup(context) {
      return context.sidebarSections.register({
        id: "fixture",
        title: "Fixture",
        icon: HouseIcon,
        component: WorkspaceSection,
      });
    },
  });

  assert.equal(manager.sidebarSections.get("fixture")?.id, "fixture");
  manager.deactivate("workbench.fixture-sidebar");
  assert.equal(manager.sidebarSections.get("fixture"), undefined);
});
