import assert from "node:assert/strict";
import test from "node:test";

import { SerializedSessionMutations } from "../src/session-mutations";

test("serializes one session's mutations and continues after rejection", async () => {
  const mutations = new SerializedSessionMutations();
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));

  const first = mutations.run(async () => {
    order.push("first:start");
    await gate;
    order.push("first:end");
  });
  const failed = mutations.run(async () => {
    order.push("failed");
    throw new Error("expected");
  });
  const last = mutations.run(async () => order.push("last"));

  await new Promise<void>((resolve) => queueMicrotask(resolve));
  assert.deepEqual(order, ["first:start"]);
  release();
  await first;
  await assert.rejects(failed, /expected/);
  await last;
  assert.deepEqual(order, ["first:start", "first:end", "failed", "last"]);
});
