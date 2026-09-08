import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRightWorkspaceResizePreview,
  beginRightWorkspaceResize,
} from "../../src/right-workspace/workspace-resize-preview";

test("outer and split drags leave document widths responsive throughout preview", () => {
  const operations: string[] = [];
  const surfaces = ["", "100%"].map((initialWidth, index) => {
    let width = initialWidth;
    return {
      style: {
        get width() {
          return width;
        },
        set width(value: string) {
          operations.push(`write:${index}`);
          width = value;
        },
      },
      getBoundingClientRect() {
        operations.push(`read:${index}`);
        return { width: 520.5 - index * 200 };
      },
    };
  });
  const frames = Array.from({ length: 3 }, () => ({
    attributes: new Map<string, string>(),
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value);
    },
    removeAttribute(name: string) {
      this.attributes.delete(name);
    },
  }));
  const [layoutFrame, workspaceFrame, shell] = frames;
  const workspace = {
    ...workspaceFrame,
    querySelectorAll(selector: string) {
      assert.equal(selector, '[data-surface-id][data-state="active"]');
      return surfaces;
    },
  };
  const previewWidths = new Map<string, string>();
  const layout = {
    ...layoutFrame,
    closest: (selector: string): unknown =>
      selector === "[data-workbench-shell]" ? shell : layout,
    querySelector: () => workspace,
    style: {
      setProperty(name: string, value: string) {
        previewWidths.set(name, value);
      },
    },
  };
  const auxiliaryPane = { closest: () => layout };

  for (const handleRoot of [layout, auxiliaryPane]) {
    operations.length = 0;
    const finish = beginRightWorkspaceResize(handleRoot as unknown as HTMLElement);
    assert.deepEqual(operations, []);
    assert.deepEqual(
      surfaces.map((surface) => surface.style.width),
      ["", "100%"],
    );
    assert.ok(frames.every((frame) => frame.attributes.get("data-resizing") === "true"));

    for (const width of [400, 900]) {
      applyRightWorkspaceResizePreview(layout as unknown as HTMLElement, width);
      assert.equal(previewWidths.get("--right-workspace-content-width"), `${width}px`);
    }
    assert.deepEqual(operations, [], "documents must reflow naturally, without pinned widths");

    finish();
    assert.deepEqual(
      surfaces.map((surface) => surface.style.width),
      ["", "100%"],
    );
    assert.ok(frames.every((frame) => !frame.attributes.has("data-resizing")));
  }
});

test("right workspace resize preview preserves the visible minimum while collapsing", () => {
  const values = new Map<string, string>();
  const workspaceLayout = {
    style: {
      setProperty(name: string, value: string) {
        values.set(name, value);
      },
    },
  } as unknown as HTMLElement;

  applyRightWorkspaceResizePreview(workspaceLayout, 80);

  assert.deepEqual(Object.fromEntries(values), {
    "--right-workspace-content-width": "360px",
    "--right-workspace-layout-width": "80px",
    "--right-workspace-resize-translate-x": "280px",
  });
});
