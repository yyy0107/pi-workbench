import assert from "node:assert/strict";
import test from "node:test";

import { nextForkTitle } from "./fork-title";

test("appends the first fork suffix to an original title", () => {
  assert.equal(nextForkTitle("Research", ["Research"]), "Research (1)");
});

test("increments the highest existing fork suffix", () => {
  assert.equal(
    nextForkTitle("Research", ["Research", "Research (1)", "Research (3)"]),
    "Research (4)",
  );
});

test("continues the sequence when forking an already suffixed title", () => {
  assert.equal(nextForkTitle("Research (2)", ["Research", "Research (1)"]), "Research (3)");
});

test("ignores unrelated suffixes and surrounding whitespace", () => {
  assert.equal(nextForkTitle("  Research  ", ["Research (notes)", "Other (9)"]), "Research (1)");
});
