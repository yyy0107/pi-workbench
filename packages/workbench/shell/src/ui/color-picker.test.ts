import assert from "node:assert/strict";
import test from "node:test";

import { normalizeHexColor } from "./color-picker";

test("normalizes color input to the six-digit format stored by appearance preferences", () => {
  assert.equal(normalizeHexColor(" #AbC "), "#aabbcc");
  assert.equal(normalizeHexColor("1234EF"), "#1234ef");
  assert.equal(normalizeHexColor("#000000"), "#000000");
  for (const value of ["", "#abcd", "#12345678", "#gggggg", "#12", "red"]) {
    assert.equal(normalizeHexColor(value), undefined);
  }
});
