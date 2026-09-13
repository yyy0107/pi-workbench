import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  resolveCollapsibleResizePreview,
  resolveCollapsibleResizeThreshold,
  useCollapsibleResize,
} from "../../src/resize/use-collapsible-resize";

function installResizeClock(t: TestContext, reducedMotion = false) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let now = 0;
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  t.mock.method(performance, "now", () => now);
  const advance = (count: number) => {
    for (let index = 0; index < count; index += 1) {
      now += 16;
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(now);
    }
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      matchMedia: () => ({ matches: reducedMotion }),
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        frames.set(++nextFrame, callback);
        return nextFrame;
      },
      cancelAnimationFrame: (frame: number) => frames.delete(frame),
    },
  });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
  return { advance, frames };
}

test("batches pointer bursts once per frame and commits the latest input before the next frame", (t) => {
  const { advance, frames } = installResizeClock(t);
  const previews: number[] = [];
  const commits: number[] = [];
  let limitReads = 0;
  let resize!: ReturnType<typeof useCollapsibleResize>;
  function Probe() {
    resize = useCollapsibleResize({
      width: 600,
      minimumWidth: 360,
      direction: -1,
      getMaximumWidth: () => {
        limitReads++;
        return 1200;
      },
      getRenderedWidth: () => 600,
      onPreview: (width) => previews.push(width),
      onCommit: (width) => commits.push(width),
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
  for (let index = 1; index <= 100; index++) {
    event.clientX = 1000 - index;
    resize.onPointerMove(event);
  }
  assert.deepEqual(previews, []);
  assert.equal(limitReads, 1, "pointer events do not repeatedly measure layout limits");
  assert.equal(frames.size, 1);
  advance(1);
  assert.deepEqual(previews, [700]);
  assert.equal(limitReads, 2);
  event.clientX = 800;
  resize.onPointerMove(event);
  resize.onPointerUp(event);
  assert.equal(commits.at(-1), 800);
  assert.equal(previews.at(-1), 800);
  assert.equal(frames.size, 0, "no stale preview can run after commit");
  advance(1);
  assert.equal(previews.at(-1), 800);

  resize.onPointerDown(event);
  event.clientX = 650;
  resize.onPointerMove(event);
  resize.onPointerCancel(event);
  assert.equal(commits.at(-1), 600, "cancel restores the measured start width");
  assert.equal(frames.size, 0);
  advance(1);
  assert.equal(previews.at(-1), 600);
});

test("keyboard resize starts from the live proportional width rather than the stored preference", () => {
  let resize!: ReturnType<typeof useCollapsibleResize>;
  let committed = 0;
  function Probe() {
    resize = useCollapsibleResize({
      width: 900,
      minimumWidth: 360,
      direction: -1,
      getMaximumWidth: () => 1200,
      getRenderedWidth: () => 700,
      onPreview() {},
      onCommit: (width) => {
        committed = width;
      },
      onOpenChange() {},
      onResizingChange() {},
    });
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  resize.onKeyDown({ key: "ArrowLeft", preventDefault() {} } as Parameters<
    typeof resize.onKeyDown
  >[0]);
  assert.equal(committed, 716);
});

test("holds the rebound width until the pointer crosses it, then follows without lag", (t) => {
  const { advance, frames } = installResizeClock(t);
  for (const direction of [-1, 1] as const) {
    let resize!: ReturnType<typeof useCollapsibleResize>;
    let preview = 600;
    let committed = 0;
    let resizing = false;
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
        onResizingChange(value) {
          resizing = value;
        },
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
    for (const width of [700, 710, 716, 720, 724, 730, 750, 380, 360, 330, 300, 250, 130]) {
      event.clientX = 1000 + direction * (width - 600);
      resize.onPointerMove(event);
      advance(1);
      assert.equal(
        preview,
        Math.max(360, width),
        "hold at the minimum while awaiting the threshold",
      );
    }
    event.clientX -= direction * 11;
    resize.onPointerMove(event);
    advance(60);
    assert.equal(preview, 0);
    event.clientX += direction * 25;
    resize.onPointerMove(event);
    assert.equal(preview, 0, "rebound starts from the rendered width instead of jumping");
    advance(2);
    assert.ok(preview > 0 && preview < 360, "rebound has intermediate animation frames");
    for (const width of [266, 300, 359, 360]) {
      const intermediate: number = preview;
      event.clientX = 1000 + direction * (width - 600);
      resize.onPointerMove(event);
      assert.equal(
        preview,
        intermediate,
        "movement below the threshold must not interrupt rebound",
      );
      assert.equal(frames.size, 2, "one spring frame and one coalesced pointer frame");
    }
    advance(60);
    assert.equal(preview, 360);
    for (const width of [361, 380, 362]) {
      event.clientX = 1000 + direction * (width - 600);
      resize.onPointerMove(event);
      advance(1);
      assert.equal(
        preview,
        Math.max(360, width),
        "only crossing the rebound position resumes tracking",
      );
    }
    resize.onPointerUp(event);
    assert.equal(committed, 360, "snapping applies only after release");

    // Releasing during rebound must also let the transition finish.
    event.clientX = 1000;
    resize.onPointerDown(event);
    event.clientX += direction * (119 - 360);
    resize.onPointerMove(event);
    advance(60);
    event.clientX += direction * 25;
    resize.onPointerMove(event);
    advance(1);
    const intermediate: number = preview;
    committed = 0;
    resize.onPointerUp(event);
    assert.equal(preview, intermediate, "release must not jump to the rebound target");
    assert.equal(committed, 0);
    assert.equal(resizing, true);
    advance(60);
    assert.equal(preview, 360);
    assert.equal(committed, 360);
    assert.equal(resizing, false);
  }
});

test("tracks changing container limits within the same drag and clamps on release", (t) => {
  const { advance } = installResizeClock(t);
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
  advance(1);
  assert.equal(preview, 840);
  maximum = 1120; // The adjacent sidebar releases 268 px without starting a new drag.
  event.clientX = 500;
  resize.onPointerMove(event);
  advance(1);
  assert.equal(preview, 940, "the divider follows the pointer beyond its original limit");
  maximum = 900;
  resize.onPointerUp(event);
  assert.equal(committed, 900, "release respects a container that narrowed during the drag");
});

test("keeps the original pointer anchor through repeated collapses and overshoots", (t) => {
  const { advance } = installResizeClock(t, true);

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
        advance(1);
      };
      resize.onPointerDown(event);
      for (let cycle = 0; cycle < 3; cycle += 1) {
        moveToWidth(119);
        assert.equal(previews.at(-1), 0);
        moveToWidth(-261);
        moveToWidth(-237);
        assert.equal(previews.at(-1), 0, "a reversal outside the pane must not shift its anchor");
        moveToWidth(143);
        assert.equal(previews.at(-1), 0, "reopening waits for the fixed release threshold");
        for (const width of [144, 143, 300, 359, 360, 361, 400]) {
          moveToWidth(width);
          assert.equal(
            previews.at(-1),
            Math.max(360, width),
            `cycle ${cycle}: hold then track without accumulating offset`,
          );
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

test("shares the sidebar edge threshold with wider workspaces", () => {
  assert.equal(resolveCollapsibleResizeThreshold(240), 120);
  assert.equal(resolveCollapsibleResizeThreshold(220), 110);
  assert.equal(resolveCollapsibleResizeThreshold(360), 120);
  assert.equal(resolveCollapsibleResizeThreshold(720), 120);
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
