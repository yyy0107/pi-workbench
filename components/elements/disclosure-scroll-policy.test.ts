import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldCompensateDisclosureOpening,
  upwardDisclosureScrollDelta,
} from "./disclosure-scroll-policy";

test("moves the full disclosure growth upward when enough space is available", () => {
  assert.equal(upwardDisclosureScrollDelta(180, 320), 180);
});

test("uses only the visible space above and lets the remainder grow downward", () => {
  assert.equal(upwardDisclosureScrollDelta(320, 120), 120);
});

test("keeps expansion downward when no space is available above", () => {
  assert.equal(upwardDisclosureScrollDelta(180, 0), 0);
});

test("does not compensate collapsing or invalid measurements", () => {
  assert.equal(upwardDisclosureScrollDelta(-80, 120), 0);
  assert.equal(upwardDisclosureScrollDelta(Number.NaN, 120), 0);
  assert.equal(upwardDisclosureScrollDelta(80, Number.POSITIVE_INFINITY), 0);
});

test("compensates only while an in-progress response opens a disclosure", () => {
  assert.equal(shouldCompensateDisclosureOpening(true, true), true);
  assert.equal(shouldCompensateDisclosureOpening(true, false), false);
  assert.equal(shouldCompensateDisclosureOpening(false, true), false);
  assert.equal(shouldCompensateDisclosureOpening(false, false), false);
});
