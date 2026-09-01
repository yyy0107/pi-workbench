import assert from "node:assert/strict";
import test from "node:test";

import {
  createRunningIndicatorCatalog,
  type RunningIndicatorDefinition,
} from "./running-indicator";

const FixtureIndicator = () => null;

function definition(id: string): RunningIndicatorDefinition {
  return { id, label: id, render: FixtureIndicator };
}

test("resolves package-owned indicator definitions and falls back for unknown persisted ids", () => {
  const fallback = definition("fallback");
  const product = definition("product.wordmark");
  const catalog = createRunningIndicatorCatalog({
    defaultStyleId: fallback.id,
    definitions: [fallback, product],
  });

  assert.equal(catalog.resolve(product.id).id, product.id);
  assert.equal(catalog.resolve("retired.product-style").id, fallback.id);
  assert.equal(Object.isFrozen(catalog), true);
  assert.equal(Object.isFrozen(catalog.definitions), true);
});

test("rejects duplicate and unknown default indicator ids", () => {
  assert.throws(
    () =>
      createRunningIndicatorCatalog({
        defaultStyleId: "duplicate",
        definitions: [definition("duplicate"), definition("duplicate")],
      }),
    /Duplicate running indicator/,
  );
  assert.throws(
    () =>
      createRunningIndicatorCatalog({
        defaultStyleId: "missing",
        definitions: [definition("available")],
      }),
    /Unknown default running indicator/,
  );
});
