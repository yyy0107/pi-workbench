import assert from "node:assert/strict";
import test from "node:test";

import type { RemoteSessionSummaryV1 } from "@workbench/remote-control-contracts/protocol";
import { createDirectConnectionProfile } from "@workbench/remote-control-client/profiles";

import {
  canMutateRemoteMachine,
  createMobileMachinesFeature,
  markRemoteMachineOnline,
} from "../src/features/machines.ts";
import { createMobileSessionCatalogFeature } from "../src/features/session-catalog.ts";

function profile(machineId: string, lastSeenAt: string, connectionState: "offline" | "ready") {
  return {
    ...createDirectConnectionProfile({
      desktop: {
        machineId,
        machineDisplayName: machineId === "machine-online" ? "Online Mac" : "Offline Mac",
        desktopEncryptionKeyId: `key-${machineId}`,
        desktopEncryptionPublicKey:
          "BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        desktopEncryptionKeyFingerprint: `sha256:${machineId}`,
      },
      deviceId: `device-${machineId}`,
      authorizationRevision: "revision-1",
      endpoints: [{ kind: "local-network" as const, host: "192.168.1.20", port: 8787 }],
      approvedAt: "2029-01-01T00:00:00.000Z",
    }),
    connectionState,
    lastSeenAt,
  };
}

test("marks an unavailable local profile catalog stale and exposes no invented machines", async () => {
  const feature = createMobileMachinesFeature({
    profiles: {
      list: async () => {
        throw new Error("storage_unavailable");
      },
    },
  });
  const snapshot = await feature.load();
  assert.equal(snapshot.stale, true);
  assert.deepEqual(snapshot.items, []);
});

test("projects paired direct profiles and sorts them by latest reachability", async () => {
  const feature = createMobileMachinesFeature({
    profiles: {
      list: async () => [
        profile("machine-offline", "2029-01-01T00:00:00.000Z", "offline"),
        profile("machine-online", "2029-01-02T00:00:00.000Z", "ready"),
      ],
    },
  });
  const snapshot = await feature.load();
  assert.equal(snapshot.stale, false);
  assert.deepEqual(
    snapshot.items.map((item) => item.machineId),
    ["machine-online", "machine-offline"],
  );
  assert.equal(canMutateRemoteMachine(snapshot.items[0]!), true);
  assert.equal(canMutateRemoteMachine(snapshot.items[1]!), false);
});

test("marks a machine online once without churning an already-current catalog", async () => {
  const feature = createMobileMachinesFeature({
    profiles: {
      list: async () => [profile("machine-online", "2029-01-02T00:00:00.000Z", "ready")],
    },
  });
  const current = await feature.load();

  assert.equal(
    markRemoteMachineOnline(current, "machine-online", "2029-01-03T00:00:00.000Z"),
    current,
  );

  const stale = { ...current, stale: true, errorCode: "network_error" };
  const recovered = markRemoteMachineOnline(stale, "machine-online", "2029-01-03T00:00:00.000Z");
  assert.notEqual(recovered, stale);
  assert.equal(recovered.stale, false);
  assert.equal(recovered.errorCode, "network_error");
  assert.equal(recovered.items[0]?.presence, "online");
  assert.equal(recovered.items[0]?.lastSeenAt, "2029-01-03T00:00:00.000Z");
  assert.equal(
    markRemoteMachineOnline(recovered, "machine-online", "2029-01-04T00:00:00.000Z"),
    recovered,
  );
});

function session(
  sessionId: string,
  updatedAt: string,
  overrides: Partial<RemoteSessionSummaryV1> = {},
): RemoteSessionSummaryV1 {
  return {
    sessionId,
    title: `Session ${sessionId}`,
    updatedAt,
    pinned: false,
    archived: false,
    attention: "none",
    runState: "idle",
    entityRevision: `revision-${sessionId}`,
    ...overrides,
  };
}

test("uses only an authoritative ready-machine session page and otherwise marks cache stale", async () => {
  const cached = [session("cached", "2029-01-01T00:00:00.000Z")];
  const remote = [
    session("recent", "2029-01-03T00:00:00.000Z"),
    session("pinned", "2029-01-02T00:00:00.000Z", { pinned: true }),
    session("archived", "2029-01-04T00:00:00.000Z", { archived: true }),
  ];
  let persisted: readonly RemoteSessionSummaryV1[] = [];
  const feature = createMobileSessionCatalogFeature({
    cache: {
      loadSessions: async () => cached,
      replaceSessions: async (_machineId, items) => void (persisted = items),
    },
    remote: { read: async () => remote },
  });
  const offline = await feature.load({ machineId: "machine-1", machineReady: false });
  assert.equal(offline.stale, true);
  assert.equal(offline.canMutate, false);
  assert.deepEqual(offline.items, cached);

  const online = await feature.load({ machineId: "machine-1", machineReady: true });
  assert.equal(online.stale, false);
  assert.equal(online.canMutate, true);
  assert.deepEqual(
    online.items.map((item) => item.sessionId),
    ["pinned", "recent"],
  );
  assert.deepEqual(persisted, online.items);
});
