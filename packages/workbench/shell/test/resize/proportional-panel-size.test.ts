import assert from "node:assert/strict";
import test from "node:test";

import {
  resolvePanelShare,
  resolveProportionalPanelWidth,
} from "../../src/resize/proportional-panel-size";
import { resolveExpandedThreadWidth } from "../../src/layout/thread-content-width";

test("opening a sidebar redistributes space in the current panel proportions", () => {
  const size = { share: resolvePanelShare(900, 1500), minimum: 360, remainingMinimum: 340 };
  assert.equal(resolveProportionalPanelWidth(1500, size), 900);
  assert.equal(resolveProportionalPanelWidth(1250, size), 750);
  assert.equal(1500 - 900, 600);
  assert.equal(1250 - 750, 500);
  assert.equal(resolveProportionalPanelWidth(1500, size), 900, "closing restores the split");
});

test("a narrow center stops shrinking at its minimum while the wider panel gives up space", () => {
  const size = { share: resolvePanelShare(1160, 1500), minimum: 360, remainingMinimum: 340 };
  let previousWidth = 1160;
  for (let sidebar = 0; sidebar <= 268; sidebar += 1) {
    const available = 1500 - sidebar;
    const right = resolveProportionalPanelWidth(available, size);
    assert.ok(right <= previousWidth, "no reverse movement during expansion");
    assert.ok(available - right >= 340 - 1e-9);
    assert.ok(Math.abs(right - previousWidth) <= 1 + 1e-9, "no width jump between frames");
    previousWidth = right;
  }
  assert.equal(previousWidth, 892);
});

test("one remaining panel takes all available space, including a zero-width container", () => {
  for (const available of [1500, 1232, 700, 360, 100, 0]) {
    assert.equal(
      resolveProportionalPanelWidth(available, { share: 1, minimum: 360, remainingMinimum: 0 }),
      available,
    );
  }
});

test("minimum bounds release proportionally and never overflow a cramped container", () => {
  const size = { share: 0.2, minimum: 360, remainingMinimum: 340 };
  assert.equal(resolveProportionalPanelWidth(1000, size), 360);
  assert.equal(resolveProportionalPanelWidth(2000, size), 400);
  assert.equal(resolveProportionalPanelWidth(500, size), 160);
  assert.equal(resolveProportionalPanelWidth(300, size), 0);
});

test("responsive sidebar decisions use the same final split throughout the animation", () => {
  const size = { share: 0.7, minimum: 360, remainingMinimum: 340 };
  const shellWidth = 1500;
  const sidebarWidth = 268;
  const finalRight = resolveProportionalPanelWidth(shellWidth - sidebarWidth, size);
  for (const sidebarOccupiedWidth of [0, 1, 50, 134, 267, 268]) {
    const available = shellWidth - sidebarOccupiedWidth;
    const right = resolveProportionalPanelWidth(available, size);
    const expanded = resolveExpandedThreadWidth({
      currentThreadWidth: available - right,
      sidebarWidth,
      sidebarOccupiedWidth,
      workspaceWidth: finalRight,
      workspaceOccupiedWidth: right,
    });
    assert.ok(Math.abs(expanded! - (shellWidth - sidebarWidth - finalRight)) < 1e-9);
  }
});

test("captures a bounded share from explicit resize geometry", () => {
  assert.equal(resolvePanelShare(800, 1000), 0.8);
  assert.equal(resolvePanelShare(800, 2000), 0.4);
  assert.equal(resolvePanelShare(800, 0), 0);
  assert.equal(resolvePanelShare(-1, 1000), 0);
  assert.equal(resolvePanelShare(1200, 1000), 1);
  assert.equal(resolvePanelShare(Number.NaN, 1000), 0);
  assert.equal(resolvePanelShare(800, Number.POSITIVE_INFINITY), 0);
});
