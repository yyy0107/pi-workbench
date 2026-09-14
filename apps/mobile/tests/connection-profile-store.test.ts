import assert from "node:assert/strict";
import test from "node:test";

import {
  createDirectConnectionProfile,
  type DirectConnectionProfile,
} from "@workbench/remote-control-client/profiles";

import { createMobileConnectionProfileStore } from "../src/state/connection-profile-store.ts";

function profile(machineId: string): DirectConnectionProfile {
  return createDirectConnectionProfile({
    desktop: {
      machineId,
      machineDisplayName: `Computer ${machineId}`,
      desktopEncryptionKeyId: `desktop-key-${machineId}`,
      desktopEncryptionPublicKey:
        "BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      desktopEncryptionKeyFingerprint: `sha256:${machineId}`,
    },
    deviceId: `device-${machineId}`,
    authorizationRevision: "authorization-1",
    endpoints: [
      { kind: "local-network", host: "192.168.1.20", port: 8787 },
      { kind: "tailscale", host: "100.64.0.8", port: 8787 },
    ],
    approvedAt: "2030-09-13T20:00:00.000Z",
  });
}

function harness() {
  const profiles = new Map<string, DirectConnectionProfile>();
  const keys = new Set<string>();
  const clearedProjections: string[] = [];
  const store = createMobileConnectionProfileStore({
    persistence: {
      list: async () => [...profiles.values()].map((value) => structuredClone(value)),
      save: async (value) => void profiles.set(value.machineId, structuredClone(value)),
      remove: async (machineId) => void profiles.delete(machineId),
    },
    secureStore: {
      loadMachineKeys: async <T extends object>(machineId: string) =>
        (keys.has(machineId) ? { privateKey: "opaque" } : undefined) as T | undefined,
      clearMachine: async (machineId) => void keys.delete(machineId),
    },
    projection: {
      clearMachine: async (machineId) => void clearedProjections.push(machineId),
    },
  });
  return { store, profiles, keys, clearedProjections };
}

test("keeps multiple direct profiles isolated and reorders only approved endpoints", async () => {
  const value = harness();
  const first = profile("machine-1");
  const second = profile("machine-2");
  await Promise.all([value.store.save(first), value.store.save(second)]);

  const reversed = [...first.endpoints].reverse().map((endpoint) => endpoint.endpointId);
  await value.store.reorder(first.machineId, reversed);
  const changed = await value.store.get(first.machineId);
  const untouched = await value.store.get(second.machineId);
  assert.equal(changed?.preferredEndpointId, reversed[0]);
  assert.deepEqual(
    changed?.endpoints.map((endpoint) => endpoint.priority),
    [0, 1],
  );
  assert.equal(untouched?.preferredEndpointId, second.preferredEndpointId);
  await assert.rejects(
    () => value.store.reorder(first.machineId, [first.endpoints[0]!.endpointId]),
    /every approved endpoint/u,
  );
});

test("promotes the last successful address and records bounded freshness", async () => {
  const value = harness();
  const original = profile("machine-1");
  await value.store.save(original);
  const tailscale = original.endpoints[1]!;
  const reachedAt = new Date("2030-09-13T20:02:00.000Z");
  await value.store.noteEndpointSuccess(
    original.machineId,
    tailscale.endpointId,
    reachedAt,
    "wy-ubuntu",
  );

  const changed = await value.store.get(original.machineId);
  assert.equal(changed?.connectionState, "ready");
  assert.equal(changed?.displayName, "wy-ubuntu");
  assert.equal(changed?.preferredEndpointId, tailscale.endpointId);
  assert.equal(changed?.lastSeenAt, reachedAt.toISOString());
  assert.equal(changed?.endpoints[0]?.lastSucceededAt, reachedAt.toISOString());
});

test("removes keys, profile, and projections for only the selected computer", async () => {
  const value = harness();
  await value.store.save(profile("machine-1"));
  await value.store.save(profile("machine-2"));
  value.keys.add("machine-1");
  value.keys.add("machine-2");
  assert.equal(await value.store.hasUsableKeys("machine-1"), true);

  await value.store.remove("machine-1");
  assert.equal(await value.store.get("machine-1"), undefined);
  assert.equal((await value.store.get("machine-2")) !== undefined, true);
  assert.deepEqual([...value.keys], ["machine-2"]);
  assert.deepEqual(value.clearedProjections, ["machine-1"]);
});

test("commits an added or edited endpoint only after identity verification and removes atomically", async () => {
  const value = harness();
  const original = profile("machine-1");
  await value.store.save(original);
  const verified: string[] = [];
  await value.store.saveEndpoint({
    machineId: original.machineId,
    endpoint: { kind: "tailscale", host: "studio.tailnet.ts.net", port: 8787 },
    approvedAt: new Date("2030-09-13T20:03:00.000Z"),
    verify: async (endpoint) => void verified.push(`${endpoint.host}:${endpoint.port}`),
  });
  let changed = await value.store.get(original.machineId);
  assert.deepEqual(verified, ["studio.tailnet.ts.net:8787"]);
  assert.equal(changed?.endpoints.length, 3);

  const endpointToEdit = changed!.endpoints[2]!;
  await assert.rejects(
    () =>
      value.store.saveEndpoint({
        machineId: original.machineId,
        endpointId: endpointToEdit.endpointId,
        endpoint: { kind: "tailscale", host: "100.100.20.30", port: 9000 },
        verify: async () => {
          throw new Error("identity_mismatch");
        },
      }),
    /identity_mismatch/u,
  );
  changed = await value.store.get(original.machineId);
  assert.equal(changed?.endpoints[2]?.endpointId, endpointToEdit.endpointId);

  await value.store.removeEndpoint(original.machineId, endpointToEdit.endpointId);
  changed = await value.store.get(original.machineId);
  assert.equal(changed?.endpoints.length, 2);
});
