import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";

import { generateDirectHpkeKeyPair } from "../packages/contracts/remote-control-contracts/src/direct-crypto.ts";
import {
  applyDirectProfileEvent,
  createDirectConnectionProfile,
  verifyDirectChallengeIdentity,
  type DirectConnectionProfile,
} from "../packages/transport/remote-control-client/src/profiles.ts";
import { createDirectRemoteGateway } from "../packages/server/remote-control-direct-server/src/gateway.ts";
import type { DirectSocketPort } from "../packages/server/remote-control-direct-server/src/ports.ts";
import { createMobileConnectionProfileStore } from "../apps/mobile/src/state/connection-profile-store.ts";

const approvedAt = "2030-09-14T20:00:00.000Z";
const lan = { kind: "local-network", host: "192.168.1.20", port: 8787 } as const;
const tailscale = { kind: "tailscale", host: "100.64.0.8", port: 8787 } as const;

function profile(
  machineId: string,
  deviceId: string,
  fingerprint: string,
  endpoints = [lan, tailscale],
): DirectConnectionProfile {
  return createDirectConnectionProfile({
    desktop: {
      machineId,
      machineDisplayName: machineId === "machine-a" ? "Studio" : "Laptop",
      desktopEncryptionKeyId: `desktop-key-${machineId}`,
      desktopEncryptionPublicKey: "A".repeat(87),
      desktopEncryptionKeyFingerprint: fingerprint,
    },
    deviceId,
    authorizationRevision: `authorization-${deviceId}`,
    endpoints,
    approvedAt,
  });
}

test("keeps two computers and phones isolated across fallback, DHCP edits, mismatch, revoke, and disable", async (t) => {
  const profiles = new Map<string, DirectConnectionProfile>();
  const keys = new Set(["machine-a", "machine-b"]);
  const projections = new Set(["machine-a", "machine-b"]);
  const store = createMobileConnectionProfileStore({
    persistence: {
      list: async () => [...profiles.values()],
      save: async (value) => void profiles.set(value.machineId, structuredClone(value)),
      remove: async (machineId) => void profiles.delete(machineId),
    },
    secureStore: {
      loadMachineKeys: async (machineId) => (keys.has(machineId) ? { present: true } : undefined),
      clearMachine: async (machineId) => void keys.delete(machineId),
    },
    projection: { clearMachine: async (machineId) => void projections.delete(machineId) },
  });
  const first = profile("machine-a", "phone-a", "sha256:machine-a");
  const second = profile("machine-b", "phone-b", "sha256:machine-b");
  await store.save(first);
  await store.save(second);

  const fallback = first.endpoints.find(({ kind }) => kind === "tailscale");
  assert.ok(fallback);
  await store.noteEndpointSuccess("machine-a", fallback.endpointId, new Date(approvedAt));
  assert.equal((await store.get("machine-a"))?.preferredEndpointId, fallback.endpointId);
  assert.equal((await store.get("machine-b"))?.preferredEndpointId, second.preferredEndpointId);

  const dhcpEndpoint = { kind: "local-network", host: "192.168.1.55", port: 8787 } as const;
  const originalLan = first.endpoints.find(({ kind }) => kind === "local-network");
  assert.ok(originalLan);
  await store.saveEndpoint({
    machineId: "machine-a",
    endpointId: originalLan.endpointId,
    endpoint: dhcpEndpoint,
    approvedAt: new Date(approvedAt),
    verify: async () => {
      assert.equal(
        verifyDirectChallengeIdentity(first, {
          machineId: first.machineId,
          desktopEncryptionKeyId: first.desktopEncryptionKeyId,
          desktopEncryptionKeyFingerprint: first.desktopFingerprint,
        }),
        true,
      );
    },
  });
  const edited = (await store.get("machine-a"))!;
  assert.deepEqual(
    edited.endpoints.map(({ host }) => host),
    [tailscale.host, dhcpEndpoint.host],
  );
  assert.equal(await store.hasUsableKeys("machine-a"), true);

  const beforeMismatch = JSON.stringify(await store.list());
  await assert.rejects(
    () =>
      store.saveEndpoint({
        machineId: "machine-a",
        endpointId: edited.endpoints[1]!.endpointId,
        endpoint: { ...dhcpEndpoint, host: "192.168.1.56" },
        verify: async () => {
          if (
            !verifyDirectChallengeIdentity(edited, {
              machineId: edited.machineId,
              desktopEncryptionKeyId: edited.desktopEncryptionKeyId,
              desktopEncryptionKeyFingerprint: "sha256:substituted-machine",
            })
          ) {
            throw new Error("identity_mismatch");
          }
        },
      }),
    /identity_mismatch/u,
  );
  assert.equal(JSON.stringify(await store.list()), beforeMismatch);

  const revoked = applyDirectProfileEvent("ready", "revoke");
  await store.save({ ...edited, connectionState: revoked.state });
  assert.equal((await store.get("machine-a"))?.connectionState, "revoked");
  assert.equal((await store.get("machine-b"))?.connectionState, "offline");
  await store.remove("machine-a");
  assert.equal(await store.get("machine-a"), undefined);
  assert.ok(await store.get("machine-b"));
  assert.equal(keys.has("machine-a"), false);
  assert.equal(keys.has("machine-b"), true);
  assert.equal(projections.has("machine-a"), false);
  assert.equal(projections.has("machine-b"), true);

  const desktopKeys = await generateDirectHpkeKeyPair();
  const gateway = createDirectRemoteGateway({
    installation: {
      machineId: "machine-disabled",
      displayName: "Disabled Workbench",
      encryptionKeyId: "desktop-key-disabled",
      encryptionPublicKey: Buffer.from(desktopKeys.publicKey).toString("base64url"),
      encryptionPrivateKey: Buffer.from(desktopKeys.privateKey).toString("base64url"),
      fingerprint: `sha256:${createHash("sha256").update(desktopKeys.publicKey).digest("base64url")}`,
      createdAt: approvedAt,
    },
    endpoints: () => [tailscale],
    clock: { now: () => new Date(approvedAt) },
    randomBytes: (size) => randomBytes(size),
    authorizationStore: { list: async () => [], replace: async () => {} },
    approval: { publishClaim() {} },
  });
  t.after(() => gateway.dispose());
  gateway.dispose();
  const closes: Array<{ readonly code?: number; readonly reason?: string }> = [];
  const socket: DirectSocketPort = {
    send: async () => {},
    close: (code, reason) => void closes.push({ code, reason }),
    onMessage: () => ({ dispose() {} }),
    onClose: () => ({ dispose() {} }),
  };
  gateway.accept(socket, tailscale, "authenticated");
  assert.deepEqual(closes, [{ code: 1008, reason: "listener_disabled" }]);
});
