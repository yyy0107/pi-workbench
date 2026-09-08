import assert from "node:assert/strict";
import test from "node:test";

import { groupModelSelectorOptions, type ModelSelectorOption } from "./model-selector-models";

test("model groups preserve provider IDs, first appearance, and original item order", () => {
  const models: ModelSelectorOption[] = ["second", "first", "second", "first"].map(
    (provider, index) => ({
      id: `${provider}/${index}`,
      provider,
      providerName: "Shared provider name",
      model: String(index),
      name: `Model ${index}`,
    }),
  );
  const groups = groupModelSelectorOptions(models);

  assert.deepEqual([...groups.keys()], ["second", "first"]);
  for (const [provider, expected] of [
    ["second", [models[0], models[2]]],
    ["first", [models[1], models[3]]],
  ] as const) {
    const actual = groups.get(provider)!;
    assert.equal(actual.length, expected.length);
    expected.forEach((model, index) => assert.equal(actual[index], model));
  }
  assert.deepEqual(groupModelSelectorOptions([]), new Map());
});
