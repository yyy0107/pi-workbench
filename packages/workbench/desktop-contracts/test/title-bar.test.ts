import assert from "node:assert/strict";
import test from "node:test";

import { defineTitleBarOverlay, isTitleBarOverlay, parseTitleBarOverlay } from "../src/title-bar";

test("defines immutable opaque title-bar colors", () => {
  const overlay = defineTitleBarOverlay({ color: "#18181b", symbolColor: "#FAFAFA" });

  assert.equal(Object.isFrozen(overlay), true);
  assert.deepEqual(overlay, { color: "#18181b", symbolColor: "#FAFAFA" });
  assert.equal(isTitleBarOverlay(overlay), true);
});

test("rejects incomplete, transparent, extended, and non-color title-bar payloads", () => {
  for (const invalid of [
    undefined,
    { color: "#18181b" },
    { color: "rgba(0, 0, 0, 0)", symbolColor: "#fafafa" },
    { color: "#18181b", symbolColor: "#fafafa", ignored: true },
    { color: "#18181b", symbolColor: 42 },
  ]) {
    assert.equal(parseTitleBarOverlay(invalid), undefined);
  }
  assert.throws(() => defineTitleBarOverlay({ color: "#fff", symbolColor: "#000" }), /Invalid/);
});
