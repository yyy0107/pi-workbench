import assert from "node:assert/strict";
import test from "node:test";

import { defineTitleBarOverlay, isTitleBarOverlay, parseTitleBarOverlay } from "../src/title-bar";

test("defines immutable opaque title-bar colors", () => {
  const overlay = defineTitleBarOverlay({ color: "#18181b", symbolColor: "#FAFAFA" });

  assert.equal(Object.isFrozen(overlay), true);
  assert.deepEqual(overlay, { color: "#18181b", symbolColor: "#FAFAFA" });
  assert.equal(isTitleBarOverlay(overlay), true);
});

test("allows a transparent title-bar background with opaque symbols", () => {
  const input = { color: "#00000000", symbolColor: "#FAFAFA" };
  const overlay = defineTitleBarOverlay(input);

  assert.equal(Object.isFrozen(overlay), true);
  assert.notEqual(overlay, input);
  assert.deepEqual(overlay, input);
  assert.equal(isTitleBarOverlay(overlay), true);
});

test("rejects incomplete, extended, and unsupported title-bar colors", () => {
  for (const invalid of [
    undefined,
    { color: "#18181b" },
    { color: "rgba(0, 0, 0, 0)", symbolColor: "#fafafa" },
    { color: "transparent", symbolColor: "#fafafa" },
    { color: "#00000000", symbolColor: "transparent" },
    { color: "#00000000", symbolColor: "#ffffff80" },
    { color: "#18181b", symbolColor: "#fafafa", ignored: true },
    { color: "#18181b", symbolColor: 42 },
  ]) {
    assert.equal(parseTitleBarOverlay(invalid), undefined);
  }
  assert.throws(() => defineTitleBarOverlay({ color: "#fff", symbolColor: "#000" }), /Invalid/);
});
