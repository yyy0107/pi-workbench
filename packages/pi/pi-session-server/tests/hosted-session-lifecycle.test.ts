import assert from "node:assert/strict";
import test from "node:test";

import { HostedSessionLifecycle } from "../src/hosted-session-lifecycle";

test("one hosted lifecycle stops and disposes exactly once", async () => {
  let stops = 0;
  let disposals = 0;
  const lifecycle = new HostedSessionLifecycle(async () => {
    disposals += 1;
  });
  const shutdown = () =>
    lifecycle.shutdown(async () => {
      stops += 1;
      await lifecycle.dispose();
    });

  assert.equal(lifecycle.isAlive, true);
  const first = shutdown();
  const second = shutdown();
  assert.equal(first, second);
  assert.equal(lifecycle.isAlive, false);
  await Promise.all([first, second]);
  assert.equal(stops, 1);
  assert.equal(disposals, 1);
});
