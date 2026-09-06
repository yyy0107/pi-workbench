import assert from "node:assert/strict";
import test from "node:test";
import { applySidebarResizePreview } from "./sidebar-resize-handle";

test("sidebar collapse progress follows the live width in both drag directions", () => {
  const properties = new Map<string, string>();
  const attributes = new Map<string, string>();
  const shell = {
    style: { setProperty: (name: string, value: string) => properties.set(name, value) },
    setAttribute: (name: string, value: string) => attributes.set(name, value),
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
    applySidebarResizePreview(null, shell, width, 200);
    assert.equal(Number(properties.get("--sidebar-collapse-progress")), progress);
    assert.equal(attributes.has("data-sidebar-collapse-preview"), width < 200);
  }
  applySidebarResizePreview(null, shell, 0, 0);
  assert.equal(properties.get("--sidebar-collapse-progress"), "0");
});
