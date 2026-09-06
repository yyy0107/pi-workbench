import assert from "node:assert/strict";
import test from "node:test";
import { applySidebarResizePreview } from "./sidebar-resize-handle";

test("sidebar resize keeps live geometry local without notifying Shell appearance observers", () => {
  const layoutProperties = new Map<string, string>();
  const headerProperties = new Map<string, string>();
  const railProperties = new Map<string, string>();
  const attributes = new Map<string, string>();
  let collapseNotifications = 0;
  const layout = {
    style: { setProperty: (name: string, value: string) => layoutProperties.set(name, value) },
  } as unknown as HTMLElement;
  const header = {
    style: { setProperty: (name: string, value: string) => headerProperties.set(name, value) },
  };
  const rail = {
    style: { setProperty: (name: string, value: string) => railProperties.set(name, value) },
  };
  const shell = {
    style: { setProperty: () => assert.fail("drag previews must not mutate Shell styles") },
    querySelector: (selector: string) =>
      selector === '[data-workbench-surface="header"]'
        ? header
        : selector === "[data-main-view-sidebar-rail]"
          ? rail
          : null,
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => {
      collapseNotifications += 1;
      attributes.set(name, value);
    },
    removeAttribute: (name: string) => attributes.delete(name),
  } as unknown as HTMLElement;

  for (const [width, progress] of [
    [300, 0],
    [200, 0],
    [150, 0.25],
    [100, 0.5],
    [0, 1],
    [100, 0.5],
    [200, 0],
  ]) {
    applySidebarResizePreview(layout, shell, width, 200);
    assert.equal(layoutProperties.get("--workbench-sidebar-layout-width"), `${width}px`);
    assert.equal(
      layoutProperties.get("--workbench-sidebar-content-width"),
      `${Math.max(width, 200)}px`,
    );
    assert.equal(
      layoutProperties.get("--workbench-sidebar-resize-translate-x"),
      `${Math.min(0, width - 200)}px`,
    );
    assert.equal(headerProperties.get("--sidebar-width"), `${width}px`);
    assert.equal(Number(railProperties.get("--sidebar-collapse-progress")), progress);
    assert.equal(attributes.has("data-sidebar-collapse-preview"), width < 200);
  }
  assert.equal(collapseNotifications, 1, "only crossing the collapse boundary notifies Shell");
  applySidebarResizePreview(null, shell, 0, 0);
  assert.equal(railProperties.get("--sidebar-collapse-progress"), "0");
});
