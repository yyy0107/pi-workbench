import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  resolveCollapsibleResizePreview,
  resolveCollapsibleResizeThreshold,
  useCollapsibleResize,
} from "../../src/resize/use-collapsible-resize";

test("follows every pointer move through snap points and the collapse approach without spring lag", (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let cancelledFrames = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      matchMedia: () => ({ matches: false }),
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => {
        cancelledFrames += 1;
      },
    },
  });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
  for (const direction of [-1, 1] as const) {
    let resize!: ReturnType<typeof useCollapsibleResize>;
    let preview = 600;
    let committed = 0;
    function Probe() {
      resize = useCollapsibleResize({
        width: 600,
        minimumWidth: 360,
        direction,
        getMaximumWidth: () => 1200,
        getRenderedWidth: () => preview,
        getSnapPoints: () => [360, 720],
        onPreview: (width) => {
          preview = width;
        },
        onCommit: (width) => {
          committed = width;
        },
        onOpenChange() {},
        onResizingChange() {},
      });
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    const event = {
      button: 0,
      pointerId: 1,
      clientX: 1000,
      currentTarget: {
        setAttribute() {},
        setPointerCapture() {},
        hasPointerCapture: () => true,
        releasePointerCapture() {},
      },
    } as unknown as Parameters<typeof resize.onPointerDown>[0];
    resize.onPointerDown(event);
    for (const width of [700, 710, 716, 720, 724, 730, 750, 380, 360, 330, 300, 250]) {
      event.clientX = 1000 + direction * (width - 600);
      resize.onPointerMove(event);
      assert.equal(preview, width, "preview must match the pointer before an animation frame");
    }
    event.clientX -= direction * 11;
    resize.onPointerMove(event); // Starts a collapse spring; no animation frame has run.
    const cancellations = cancelledFrames;
    event.clientX += direction * 25;
    resize.onPointerMove(event);
    assert.equal(preview, 264, "reversal resumes at the pointer's absolute width");
    assert.equal(cancelledFrames, cancellations + 1);
    event.clientX += direction * 2;
    resize.onPointerMove(event);
    assert.equal(preview, 266, "the reopened divider stays at the original pointer offset");
    resize.onPointerUp(event);
    assert.equal(committed, 360, "snapping applies only after release");
  }
});

test("tracks changing container limits within the same drag and clamps on release", () => {
  let resize!: ReturnType<typeof useCollapsibleResize>;
  let maximum = 852;
  let preview = 360;
  let committed = 0;
  function Probe() {
    resize = useCollapsibleResize({
      width: 360,
      minimumWidth: 360,
      direction: -1,
      getMaximumWidth: () => maximum,
      getRenderedWidth: () => preview,
      onPreview: (width) => {
        preview = width;
      },
      onCommit: (width) => {
        committed = width;
      },
      onOpenChange() {},
      onResizingChange() {},
    });
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  const event = {
    button: 0,
    pointerId: 1,
    clientX: 1080,
    currentTarget: {
      setAttribute() {},
      setPointerCapture() {},
      hasPointerCapture: () => true,
      releasePointerCapture() {},
    },
  } as unknown as Parameters<typeof resize.onPointerDown>[0];
  resize.onPointerDown(event);
  event.clientX = 600;
  resize.onPointerMove(event);
  assert.equal(preview, 840);
  maximum = 1120; // The adjacent sidebar releases 268 px without starting a new drag.
  event.clientX = 500;
  resize.onPointerMove(event);
  assert.equal(preview, 940, "the divider follows the pointer beyond its original limit");
  maximum = 900;
  resize.onPointerUp(event);
  assert.equal(committed, 900, "release respects a container that narrowed during the drag");
});

test("keeps the original pointer anchor through repeated collapses and overshoots", (t) => {
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
      const moveToWidth = (width: number) => {
        event.clientX = 1000 + direction * (width - 720);
        resize.onPointerMove(event);
      };
      resize.onPointerDown(event);
      for (let cycle = 0; cycle < 3; cycle += 1) {
        moveToWidth(239);
        assert.equal(previews.at(-1), 0);
        moveToWidth(-261);
        moveToWidth(-237);
        assert.equal(previews.at(-1), 0, "a reversal outside the pane must not shift its anchor");
        moveToWidth(263);
        assert.equal(previews.at(-1), 0, "reopening waits for the fixed release threshold");
        for (const width of [264, 263, 300, 400]) {
          moveToWidth(width);
          assert.equal(previews.at(-1), width, `cycle ${cycle}: no accumulated pointer offset`);
        }
      }

      if (finish === "cancel") resize.onPointerCancel(event);
      else resize.onPointerUp(event);
      assert.deepEqual(commits, [finish === "cancel" ? 720 : 400]);
      assert.deepEqual(open, [true, true, true, true]);
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
