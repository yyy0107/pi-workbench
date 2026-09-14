import assert from "node:assert/strict";
import test from "node:test";

import {
  clearMobileAuthorization,
  reconcileMobileInstallation,
} from "../src/state/installation.ts";

function createHarness({ sentinelExists }: { sentinelExists: boolean }) {
  const calls: string[] = [];
  return {
    calls,
    ports: {
      sentinel: {
        exists: async () => sentinelExists,
        create: async () => void calls.push("sentinel.create"),
      },
      credentials: {
        clearAll: async () => void calls.push("credentials.clearAll"),
        clearMachine: async (machineId: string) =>
          void calls.push(`credentials.clearMachine:${machineId}`),
      },
      projection: {
        clearAll: async () => void calls.push("projection.clearAll"),
        clearMachine: async (machineId: string) =>
          void calls.push(`projection.clearMachine:${machineId}`),
      },
    },
  };
}

test("clears surviving iOS secure values when the SQLite installation sentinel is missing", async () => {
  const harness = createHarness({ sentinelExists: false });
  assert.equal(
    await reconcileMobileInstallation({ platform: "ios", ...harness.ports }),
    "initialized",
  );
  assert.deepEqual(harness.calls, [
    "credentials.clearAll",
    "projection.clearAll",
    "sentinel.create",
  ]);
});

test("retains credentials and projection when the installation sentinel exists", async () => {
  const harness = createHarness({ sentinelExists: true });
  assert.equal(
    await reconcileMobileInstallation({ platform: "ios", ...harness.ports }),
    "existing",
  );
  assert.deepEqual(harness.calls, []);
});

test("clears one computer's keys and projections without touching other profiles", async () => {
  const machine = createHarness({ sentinelExists: true });
  await clearMobileAuthorization({
    machineId: "machine-1",
    ...machine.ports,
  });
  assert.deepEqual(machine.calls, [
    "credentials.clearMachine:machine-1",
    "projection.clearMachine:machine-1",
  ]);
});
