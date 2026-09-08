import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  resolveCollapsibleResizePreview,
  resolveCollapsibleResizeThreshold,
  useCollapsibleResize,
} from "../../src/resize/use-collapsible-resize";

test("reopens after a short reversal even after overshooting, without losing cancel's original width", (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { matchMedia: () => ({ matches: true }) },
  });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });

  for (const direction of [-1, 1] as const) {
    for (const finish of ["commit", "cancel"] as const) {
      let resize!: ReturnType<typeof useCollapsibleResize>;
      const previews: number[] = [];
      const commits: number[] = [];
      const open: boolean[] = [];
      const resizing: boolean[] = [];
      function Probe() {
        resize = useCollapsibleResize({
          width: 720,
          minimumWidth: 360,
          direction,
          getMaximumWidth: () => 1000,
          getRenderedWidth: () => 720,
          onPreview: (width) => previews.push(width),
          onCommit: (width) => commits.push(width),
          onOpenChange: (value) => open.push(value),
          onResizingChange: (value) => resizing.push(value),
        });
        return null;
      }
      renderToStaticMarkup(createElement(Probe));
      let captured = false;
      const event = {
        button: 0,
        pointerId: 1,
        clientX: 1000,
        currentTarget: {
          setAttribute() {},
          setPointerCapture: () => {
            captured = true;
          },
          hasPointerCapture: () => captured,
          releasePointerCapture: () => {
            captured = false;
          },
        },
      } as unknown as Parameters<typeof resize.onPointerDown>[0];
      const move = (distance: number) => {
        event.clientX += direction * distance;
        resize.onPointerMove(event);
      };
      resize.onPointerDown(event);
      move(-481);
      assert.equal(previews.at(-1), 0);
      move(-500);
      move(23);
      assert.equal(previews.at(-1), 0, "small reversals must not reopen the pane");
      move(1);
      assert.equal(previews.at(-1), 360, "24 px reverses even a deeply overshot collapse");
      move(-1);
      assert.equal(previews.at(-1), 360, "reopening must not immediately collapse again");
      move(41);
      assert.equal(previews.at(-1), 400, "dragging continues from the reopened width");
      move(-161);
      assert.equal(previews.at(-1), 0);
      move(-300);
      move(64);
      assert.equal(previews.at(-1), 400, "repeated reopening retains motion beyond the threshold");

      if (finish === "cancel") resize.onPointerCancel(event);
      else resize.onPointerUp(event);
      assert.deepEqual(commits, [finish === "cancel" ? 720 : 400]);
      assert.deepEqual(open, [true, true, true]);
      assert.deepEqual(resizing, [true, false]);
      assert.equal(captured, false);
    }
  }
});

test("caps the default collapse distance at the sidebar distance for wider panels", () => {
  assert.equal(resolveCollapsibleResizeThreshold(240), 120);
  assert.equal(resolveCollapsibleResizeThreshold(220), 110);
  assert.equal(resolveCollapsibleResizeThreshold(360), 240);
  assert.equal(resolveCollapsibleResizeThreshold(720), 600);
  assert.equal(resolveCollapsibleResizeThreshold(0), 0);
});

test("bounds custom collapse ratios", () => {
  assert.equal(resolveCollapsibleResizeThreshold(240, 0.75), 60);
  assert.equal(resolveCollapsibleResizeThreshold(240, -1), 240);
  assert.equal(resolveCollapsibleResizeThreshold(240, 2), 0);
});

test("keeps sidebar content at its minimum width while the layout collapses", () => {
  assert.deepEqual(resolveCollapsibleResizePreview(80, 240, 1), {
    layoutWidth: 80,
    contentWidth: 240,
    translateX: -160,
  });
  assert.deepEqual(resolveCollapsibleResizePreview(80, 360, -1), {
    layoutWidth: 80,
    contentWidth: 360,
    translateX: 280,
  });
});

test("keeps resize previews aligned once they are wider than the minimum", () => {
  assert.deepEqual(resolveCollapsibleResizePreview(420, 240, 1), {
    layoutWidth: 420,
    contentWidth: 420,
    translateX: 0,
  });
});
