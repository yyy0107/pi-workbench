const assert = require("node:assert/strict");
const test = require("node:test");

const {
  copyTitleBarOverlayOptions,
  isTitleBarOverlayOptions,
} = require("../src/title-bar-overlay.cjs");

test("accepts and copies only complete opaque title-bar overlay options", () => {
  const input = { color: "#18181b", symbolColor: "#FAFAFA" };
  const copied = copyTitleBarOverlayOptions(input);

  assert.equal(isTitleBarOverlayOptions(input), true);
  assert.equal(Object.isFrozen(copied), true);
  assert.notEqual(copied, input);
  assert.deepEqual(copied, input);
});

test("accepts a transparent background without allowing transparent symbols", () => {
  const input = { color: "#00000000", symbolColor: "#FAFAFA" };
  const copied = copyTitleBarOverlayOptions(input);

  assert.equal(isTitleBarOverlayOptions(input), true);
  assert.equal(Object.isFrozen(copied), true);
  assert.notEqual(copied, input);
  assert.deepEqual(copied, input);
});

test("rejects malformed title-bar overlay IPC payloads", () => {
  for (const value of [
    undefined,
    { color: "#fff", symbolColor: "#000" },
    { color: "rgba(0,0,0,0)", symbolColor: "#000000" },
    { color: "transparent", symbolColor: "#fafafa" },
    { color: "#00000000", symbolColor: "transparent" },
    { color: "#00000000", symbolColor: "#ffffff80" },
    { color: "#000000", symbolColor: "#ffffff", extra: true },
  ]) {
    assert.equal(isTitleBarOverlayOptions(value), false);
    assert.equal(copyTitleBarOverlayOptions(value), undefined);
  }
});
