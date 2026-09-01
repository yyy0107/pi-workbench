import assert from "node:assert/strict";
import test from "node:test";

import {
  beginPiSessionManagerLifecycle,
  type PiSessionManagerLifecycleTarget,
} from "../../src/assistant-ui/session-manager-lifecycle";

function managerFixture(): PiSessionManagerLifecycleTarget & {
  readonly starts: number;
  readonly disposals: number;
} {
  let starts = 0;
  let disposals = 0;
  return {
    get starts() {
      return starts;
    },
    get disposals() {
      return disposals;
    },
    async start() {
      starts += 1;
    },
    dispose() {
      disposals += 1;
    },
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function unexpectedStartError(error: unknown): never {
  return assert.fail(error instanceof Error ? error : String(error));
}

test("Strict Effects replay retains the manager until the final cleanup", async () => {
  const manager = managerFixture();
  const owner = { current: manager };
  const generation = { current: 0 };
  const firstCleanup = beginPiSessionManagerLifecycle(
    manager,
    owner,
    generation,
    unexpectedStartError,
  );

  firstCleanup();
  const finalCleanup = beginPiSessionManagerLifecycle(
    manager,
    owner,
    generation,
    unexpectedStartError,
  );
  await flushMicrotasks();

  assert.equal(manager.starts, 2);
  assert.equal(manager.disposals, 0);

  finalCleanup();
  await flushMicrotasks();
  assert.equal(manager.disposals, 1);
});

test("a manager replacement disposes the previous owner", async () => {
  const previous = managerFixture();
  const replacement = managerFixture();
  const owner: { current: PiSessionManagerLifecycleTarget | null } = { current: previous };
  const generation = { current: 0 };
  const cleanup = beginPiSessionManagerLifecycle(previous, owner, generation, unexpectedStartError);

  owner.current = replacement;
  cleanup();
  await flushMicrotasks();

  assert.equal(previous.disposals, 1);
  assert.equal(replacement.disposals, 0);
});
