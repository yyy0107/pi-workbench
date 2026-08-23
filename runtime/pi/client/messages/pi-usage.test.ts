import assert from "node:assert/strict";
import test from "node:test";

import { readPiUsage } from "./pi-usage";

test("reads finite non-negative Pi usage metadata", () => {
  assert.deepEqual(
    readPiUsage({ input: 12, output: 8, cacheRead: 4, cacheWrite: 2, totalTokens: 26 }),
    { input: 12, output: 8, cacheRead: 4, cacheWrite: 2, totalTokens: 26 },
  );
  assert.deepEqual(readPiUsage({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  });
});

test("rejects malformed or unsafe Pi usage metadata", () => {
  const base = { input: 12, output: 8, cacheRead: 4, cacheWrite: 2 };

  assert.equal(readPiUsage(null), undefined);
  assert.equal(readPiUsage([]), undefined);
  assert.equal(readPiUsage({ ...base, output: -1 }), undefined);
  assert.equal(readPiUsage({ ...base, input: Number.NaN }), undefined);
  assert.equal(readPiUsage({ ...base, cacheRead: Number.POSITIVE_INFINITY }), undefined);
  assert.equal(readPiUsage({ ...base, totalTokens: -1 }), undefined);
});
