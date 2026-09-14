import assert from "node:assert/strict";
import test from "node:test";

import {
  addDirectProfileEndpoint,
  applyDirectProfileEvent,
  createDirectConnectionProfile,
  removeDirectProfileEndpoint,
  reorderDirectProfileEndpoints,
  replaceDirectProfileEndpoint,
  verifyDirectChallengeIdentity,
} from "../src/profiles.ts";
import { classifyDirectClientHost, validateDirectClientEndpoint } from "../src/endpoint-policy.ts";

const desktop = {
  machineId: "machine-1",
  machineDisplayName: "Desktop",
  desktopEncryptionKeyId: "desktop-key-1",
  desktopEncryptionPublicKey: "A".repeat(87),
  desktopEncryptionKeyFingerprint: `sha256:${"a".repeat(43)}`,
} as const;

test("creates an account-free profile with explicitly approved endpoint priority", () => {
  const profile = createDirectConnectionProfile({
    desktop,
    deviceId: "phone-1",
    authorizationRevision: "revision-1",
    endpoints: [
      { kind: "local-network", host: "192.168.1.20", port: 8787 },
      { kind: "tailscale", host: "100.100.10.20", port: 8787 },
    ],
    approvedAt: "2026-09-13T12:00:00.000Z",
  });
  assert.equal("accountId" in profile, false);
  assert.equal("relayOrigin" in profile, false);
  assert.equal(profile.endpoints[0]?.priority, 0);
  assert.equal(profile.preferredEndpointId, profile.endpoints[0]?.endpointId);

  const reordered = reorderDirectProfileEndpoints(profile, [
    profile.endpoints[1]!.endpointId,
    profile.endpoints[0]!.endpointId,
  ]);
  assert.equal(reordered.preferredEndpointId, profile.endpoints[1]?.endpointId);
  assert.deepEqual(
    reordered.endpoints.map((item) => item.priority),
    [0, 1],
  );
});

test("pins machine and desktop key identity before authentication", () => {
  const profile = createDirectConnectionProfile({
    desktop,
    deviceId: "phone-1",
    authorizationRevision: "revision-1",
    endpoints: [{ kind: "local-network", host: "192.168.1.20", port: 8787 }],
    approvedAt: "2026-09-13T12:00:00.000Z",
  });
  assert.equal(
    verifyDirectChallengeIdentity(profile, {
      machineId: desktop.machineId,
      desktopEncryptionKeyId: desktop.desktopEncryptionKeyId,
      desktopEncryptionKeyFingerprint: desktop.desktopEncryptionKeyFingerprint,
    }),
    true,
  );
  assert.equal(
    verifyDirectChallengeIdentity(profile, {
      machineId: desktop.machineId,
      desktopEncryptionKeyId: "attacker-key",
      desktopEncryptionKeyFingerprint: `sha256:${"b".repeat(43)}`,
    }),
    false,
  );
});

test("uses direct profile states and suppresses reconnect after identity mismatch or revoke", () => {
  assert.deepEqual(applyDirectProfileEvent("offline", "connect"), {
    state: "connecting",
    reconnectAllowed: true,
  });
  assert.deepEqual(applyDirectProfileEvent("authenticating", "identity-mismatch"), {
    state: "identity-mismatch",
    reconnectAllowed: false,
  });
  assert.deepEqual(applyDirectProfileEvent("ready", "revoke"), {
    state: "revoked",
    reconnectAllowed: false,
  });
  assert.deepEqual(applyDirectProfileEvent("ready", "suspend"), {
    state: "suspended",
    reconnectAllowed: false,
  });
});

test("accepts only directly reachable private LAN and Tailscale profile endpoints", () => {
  assert.equal(classifyDirectClientHost("192.168.1.20"), "local-network");
  assert.equal(classifyDirectClientHost("100.100.10.20"), "tailscale");
  assert.equal(classifyDirectClientHost("workbench.tailnet.ts.net"), "tailscale");
  assert.deepEqual(
    validateDirectClientEndpoint({ kind: "local-network", host: "WORKBENCH.LOCAL", port: 8787 }),
    { kind: "local-network", host: "workbench.local", port: 8787 },
  );
  assert.throws(
    () => validateDirectClientEndpoint({ kind: "local-network", host: "8.8.8.8", port: 8787 }),
    /endpoint_not_allowed/u,
  );
});

test("adds, edits, and removes only explicit endpoints while preserving the pinned identity", () => {
  const profile = createDirectConnectionProfile({
    desktop,
    deviceId: "phone-1",
    authorizationRevision: "revision-1",
    endpoints: [{ kind: "local-network", host: "192.168.1.20", port: 8787 }],
    approvedAt: "2026-09-13T12:00:00.000Z",
  });
  const added = addDirectProfileEndpoint(
    profile,
    { kind: "tailscale", host: "workbench.tailnet.ts.net", port: 8787 },
    "2026-09-13T12:01:00.000Z",
  );
  assert.equal(added.machineId, profile.machineId);
  assert.equal(added.desktopFingerprint, profile.desktopFingerprint);
  assert.equal(added.endpoints.length, 2);
  assert.throws(
    () =>
      addDirectProfileEndpoint(
        added,
        { kind: "tailscale", host: "WORKBENCH.TAILNET.TS.NET", port: 8787 },
        "2026-09-13T12:02:00.000Z",
      ),
    /unique/u,
  );

  const edited = replaceDirectProfileEndpoint(
    added,
    added.endpoints[1]!.endpointId,
    { kind: "tailscale", host: "100.100.20.30", port: 9000 },
    "2026-09-13T12:03:00.000Z",
  );
  assert.equal(edited.endpoints[1]?.host, "100.100.20.30");
  assert.equal(edited.endpoints[1]?.port, 9000);
  assert.equal(edited.preferredEndpointId, edited.endpoints[0]?.endpointId);

  const removed = removeDirectProfileEndpoint(edited, edited.endpoints[0]!.endpointId);
  assert.equal(removed.endpoints.length, 1);
  assert.equal(removed.preferredEndpointId, removed.endpoints[0]?.endpointId);
  assert.throws(
    () => removeDirectProfileEndpoint(removed, removed.endpoints[0]!.endpointId),
    /connection_endpoint_required/u,
  );
});
