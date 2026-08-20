import assert from "node:assert/strict";
import test from "node:test";

import { interpolateTokenQuantities } from "./token-animation";

const from = {
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 900,
  cacheWriteTokens: 10,
};

const target = {
  inputTokens: 500,
  outputTokens: 100,
  cacheReadTokens: 1_700,
  cacheWriteTokens: 50,
};

test("interpolates token targets over a bounded animation progress", () => {
  assert.deepEqual(interpolateTokenQuantities(from, target, 0), from);
  assert.deepEqual(interpolateTokenQuantities(from, target, 0.25), {
    inputTokens: 200,
    outputTokens: 40,
    cacheReadTokens: 1_100,
    cacheWriteTokens: 20,
  });
  assert.deepEqual(interpolateTokenQuantities(from, target, 1), target);
  assert.deepEqual(interpolateTokenQuantities(from, target, 2), target);
});

test("never animates a transient token target backwards", () => {
  assert.deepEqual(
    interpolateTokenQuantities(
      from,
      {
        inputTokens: 90,
        outputTokens: 10,
        cacheReadTokens: 800,
        cacheWriteTokens: 5,
      },
      1,
    ),
    from,
  );
});
