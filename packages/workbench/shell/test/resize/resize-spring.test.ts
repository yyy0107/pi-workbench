import assert from "node:assert/strict";
import test from "node:test";

import { applyMagneticSnap, nearestSnapPoint, projectValue } from "../../src/resize/resize-spring";

test("nearestSnapPoint selects the closest slot", () => {
  assert.equal(nearestSnapPoint(365, [0, 280, 420]), 420);
  assert.equal(nearestSnapPoint(300, [0, 280, 420]), 280);
});

test("applyMagneticSnap visibly captures and locks near a snap point", () => {
  const resisted = applyMagneticSnap(270, [0, 280, 420]);

  assert.ok(resisted > 279 && resisted < 280);
  assert.equal(applyMagneticSnap(276, [0, 280, 420]), 280);
  assert.equal(applyMagneticSnap(220, [0, 280, 420]), 220);
});

test("projectValue includes pointer velocity", () => {
  assert.equal(projectValue(330, 0.6), 414);
  assert.equal(projectValue(330, -0.5), 260);
});
