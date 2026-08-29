import assert from "node:assert/strict";
import test from "node:test";

import {
  preservesBothScrollbarGutters,
  shouldCompensateDisclosureOpening,
  upwardDisclosureScrollDelta,
} from "./disclosure-scroll-policy";

test("moves the full disclosure growth upward so content below stays fixed", () => {
  assert.equal(upwardDisclosureScrollDelta(180), 180);
  assert.equal(upwardDisclosureScrollDelta(320), 320);
});

test("does not compensate shrinking or invalid measurements", () => {
  assert.equal(upwardDisclosureScrollDelta(-80), 0);
  assert.equal(upwardDisclosureScrollDelta(Number.NaN), 0);
  assert.equal(upwardDisclosureScrollDelta(Number.POSITIVE_INFINITY), 0);
});

test("compensates only while an in-progress response opens a disclosure", () => {
  assert.equal(shouldCompensateDisclosureOpening(true, true), true);
  assert.equal(shouldCompensateDisclosureOpening(true, false), false);
  assert.equal(shouldCompensateDisclosureOpening(false, true), false);
  assert.equal(shouldCompensateDisclosureOpening(false, false), false);
});

test("recognizes a symmetric stable scrollbar gutter", () => {
  assert.equal(preservesBothScrollbarGutters("stable both-edges"), true);
  assert.equal(preservesBothScrollbarGutters("stable"), false);
  assert.equal(preservesBothScrollbarGutters("auto"), false);
  assert.equal(preservesBothScrollbarGutters(""), false);
});
